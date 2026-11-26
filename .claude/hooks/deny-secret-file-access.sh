#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash)
# บล็อกคำสั่ง Bash ที่อ้างถึงไฟล์ลับ (env / key / cert / firebase config ฯลฯ)
# อ่าน hook input เป็น JSON ทาง stdin แล้วตอบ permissionDecision=deny ถ้าเจอ

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')

# รวม pattern ไฟล์ลับทั้งหมด (case-insensitive)
secret_re='(\.env($|[./[:space:]'\''"-])|\.env\.(dev|prod)|\.(pem|key|keystore|p12|pfx|p8|crt|cer|jks|mobileprovision|certSigningRequest)([[:space:]'\''"/]|$)|credentials\.json|google-services\.json|agconnect-services\.json|GoogleService-Info\.plist|firebase_options\.dart|key\.properties|mymoph-keystore|upload_certificate|wildcard_moph_go_th|(^|/)\.secrets/|/ssl/|(^|/)key/|flyway/conf|uploads/file|environment\.production\.ts|firebase-adminsdk|sendNoti\.json)'

if printf '%s' "$cmd" | grep -Eiq "$secret_re"; then
  cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "คำสั่งนี้อ้างถึงไฟล์ลับ (env/key/cert/credentials) — ถูกบล็อกโดย policy ห้าม Claude เข้าถึงไฟล์ลับผ่าน Bash"
  }
}
JSON
  exit 0
fi

# ไม่เข้าเงื่อนไข: ปล่อยผ่านเข้าสู่ flow permission ปกติ
exit 0
