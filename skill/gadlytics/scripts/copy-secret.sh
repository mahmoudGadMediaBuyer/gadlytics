#!/bin/zsh
# GADLYTICS — copy ONE Snap secret to the clipboard (never printed) so it can be pasted into
# Supabase → Edge Functions → Secrets. Usage: zsh ~/.gadlytics/copy-secret.sh id|secret|refresh
S=~/.claude/secrets
case "$1" in
  id)      v=$(grep '^CLIENT_ID=' $S/snap.env | cut -d= -f2-) ;;
  secret)  v=$(grep '^CLIENT_SECRET=' $S/snap.env | cut -d= -f2-) ;;
  refresh) v=$(python3 -c "import json;print(json.load(open('$S/snap_token.json'))['refresh_token'])") ;;
  *) echo "usage: copy-secret.sh id|secret|refresh"; exit 1 ;;
esac
printf %s "$v" | pbcopy
echo "copied ${#v} characters — paste it now in Supabase (Cmd+V)"
