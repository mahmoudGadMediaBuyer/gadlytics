/* GADLYTICS — تخزين Supabase بنفس واجهة claude.use("db")
   جدول واحد public.docs (path, coll, data) — كل مستند ليه مسار زي "entries/molabi__2026-05-20" */
(function(){
  var C = window.GADLYTICS_CONFIG || {};
  if(!C.supabaseUrl || !C.supabaseAnonKey || !window.supabase) return;
  var sb = window.supabase.createClient(C.supabaseUrl, C.supabaseAnonKey);
  var T = "docs", PAGE = 1000;
  function parent(p){ return p.slice(0, p.lastIndexOf("/")); }
  function idOf(p){ return p.slice(p.lastIndexOf("/") + 1); }
  function fail(e){ var x = new Error((e && e.message) || String(e)); x.code = e && e.code; throw x; }
  function clone(v){ return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function snap(row){ return { id: idOf(row.path), exists: true, data: function(){ return clone(row.data); } }; }

  function docRef(path){
    return {
      get: async function(){
        var r = await sb.from(T).select("path,data").eq("path", path).maybeSingle();
        if(r.error) fail(r.error);
        return r.data ? snap(r.data) : { id: idOf(path), exists: false, data: function(){ return undefined; } };
      },
      set: async function(d){
        var r = await sb.from(T).upsert({ path: path, coll: parent(path), data: d, updated_at: new Date().toISOString() });
        if(r.error) fail(r.error);
      },
      update: async function(d){
        var s = await this.get();
        await this.set(Object.assign({}, s.exists ? s.data() : {}, d));
      },
      delete: async function(){
        var r = await sb.from(T).delete().eq("path", path);
        if(r.error) fail(r.error);
      }
    };
  }

  function build(coll, ws, ord){
    var q = sb.from(T).select("path,data").eq("coll", coll);
    ws.forEach(function(w){
      var num = typeof w[2] === "number", col = num ? "data->" + w[0] : "data->>" + w[0], v = num ? w[2] : String(w[2]);
      var op = { ">=": "gte", "<=": "lte", "==": "eq", ">": "gt", "<": "lt" }[w[1]];
      if(op) q = q.filter(col, op, v);
    });
    if(ord) q = q.order("data->>" + ord[0], { ascending: ord[1] !== "desc" });
    else q = q.order("path", { ascending: true });
    return q;
  }
  function query(coll, ws, ord, lim){
    var self = {
      where: function(f, op, v){ return query(coll, ws.concat([[f, op, v]]), ord, lim); },
      orderBy: function(f, dir){ return query(coll, ws, [f, dir || "asc"], lim); },
      limit: function(n){ return query(coll, ws, ord, n); },
      get: async function(){
        var rows = [], from = 0;
        for(;;){
          var want = lim ? Math.min(PAGE, lim - rows.length) : PAGE;
          if(want <= 0) break;
          var r = await build(coll, ws, ord).range(from, from + want - 1);
          if(r.error) fail(r.error);
          rows = rows.concat(r.data);
          if(r.data.length < want) break;
          from += want;
        }
        return { docs: rows.map(snap), size: rows.length, empty: !rows.length };
      },
      onSnapshot: function(cb, onErr){   // تحديث كل 15 ثانية بدل الاتصال اللحظي
        var last = "", stop = false;
        function tick(){
          if(stop) return;
          self.get().then(function(s){
            var k = JSON.stringify(s.docs.map(function(d){ return [d.id, d.data()]; }));
            if(k !== last){ last = k; cb(s); }
          }).catch(function(e){ if(onErr) onErr(e); });
        }
        tick(); var t = setInterval(tick, 15000);
        return function(){ stop = true; clearInterval(t); };
      }
    };
    return self;
  }

  var DBX = { doc: docRef, collection: function(c){ return query(c, [], null, null); } };

  function loginUI(msg){
    var o = document.getElementById("gad-login");
    if(!o){
      o = document.createElement("div"); o.id = "gad-login";
      o.innerHTML =
        '<style>#gad-login{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:#0B1437;font-family:Almarai,system-ui,sans-serif;direction:rtl;padding:16px}' +
        '#gad-login form{width:min(380px,100%);background:#fff;border-radius:18px;padding:28px;display:flex;flex-direction:column;gap:12px;color:#0B1437}' +
        '#gad-login h1{margin:0 0 4px;font-size:22px;letter-spacing:.08em;direction:ltr;text-align:center}#gad-login p{margin:0;color:#5B6478;font-size:13px;text-align:center}' +
        '#gad-login input{font:inherit;padding:11px 12px;border:1px solid #D7DCE8;border-radius:10px;direction:ltr;text-align:left}' +
        '#gad-login button{font:inherit;font-weight:700;padding:12px;border:0;border-radius:10px;background:#465FFF;color:#fff;cursor:pointer}' +
        '#gad-login .err{color:#C0362C;font-size:13px;min-height:18px;text-align:center}</style>' +
        '<form><h1>GADLYTICS</h1><p>سجّل دخولك علشان تشوف أرقامك</p>' +
        '<input type="email" name="e" placeholder="Email" autocomplete="username" required>' +
        '<input type="password" name="p" placeholder="Password" autocomplete="current-password" required>' +
        '<button type="submit">دخول</button><div class="err"></div></form>';
      document.body.appendChild(o);
    }
    o.querySelector(".err").textContent = msg || "";
    return o;
  }

  window.SUPA_DB = {
    client: sb, db: null,
    ready: function(){
      var api = this;
      return new Promise(async function(resolve){
        var s = await sb.auth.getSession();
        if(s.data && s.data.session){ api.db = DBX; return resolve(DBX); }
        var o = loginUI(), f = o.querySelector("form");
        f.addEventListener("submit", async function(ev){
          ev.preventDefault();
          var b = f.querySelector("button"); b.disabled = true; loginUI("");
          var r = await sb.auth.signInWithPassword({ email: f.e.value.trim(), password: f.p.value });
          b.disabled = false;
          if(r.error){ loginUI("الإيميل أو الباسورد غلط"); return; }
          o.remove(); api.db = DBX; resolve(DBX);
        });
      });
    },
    signOut: async function(){ await sb.auth.signOut(); location.reload(); }
  };
})();
