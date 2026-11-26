# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ Off-Limits Files — ห้ามอ่านหรือแก้ไข

ไฟล์ต่อไปนี้มี credentials จริง ห้าม Claude เข้าถึง (อ่าน/แก้ไข/คัดลอก/พิมพ์ออก) ไม่ว่ากรณีใด — รวมถึงผ่านคำสั่ง Bash (`cat`, `head`, `grep`, `cp`, redirect ฯลฯ):

**env**
- `.env`, `.env-*`, `.env.*` ทุกไฟล์ (รวม `assets/.env`, `assets/.env.dev`, `assets/.env.prod`)

**Keys / certificates**
- `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.p8`, `*.crt`, `*.cer`, `*.jks`, `*.keystore`, `*.mobileprovision`, `*.certSigningRequest`
- `key/**` ทั้งโฟลเดอร์ (เช่น `key/mymoph-keystore.jks`, `key/upload_certificate.pem`)
- `**/key.properties`, `id_rsa`, `id_ed25519`

**Firebase / Google / Huawei service config**
- `**/google-services.json`, `**/agconnect-services.json`, `**/GoogleService-Info.plist`, `lib/firebase_options.dart`

**อื่น ๆ**
- `**/credentials.json`, `**/.secrets/**`, `**/ssl/**`
- `flyway/conf/*` ทุกไฟล์
- `uploads/file/*` ทุกไฟล์
- `*firebase-adminsdk*.json` (service account ของ Firebase) และ `sendNoti.json` — เลิก track ใน git แล้ว ให้เก็บนอก repo

การบังคับใช้: `permissions.deny` + PreToolUse hook (`.claude/hooks/deny-secret-file-access.sh`) ใน `.claude/settings.json`, และ `.claudeignore`/`.gitignore` เพิ่มไฟล์ลับใหม่ในทั้ง 4 ที่นี้พร้อมกันเสมอ

