# Firebase service account key (local dev)

Put your Firebase service account JSON file here, e.g.  
`goldenlabs-firebase-adminsdk-fbsvc-ae98adb22c.json`

- **Local:** `.env` uses `FIREBASE_SERVICE_ACCOUNT_PATH=./keys/your-file.json`
- **Deployment:** Do **not** upload this folder. On your host (Vercel, Railway, etc.) set the env var **`FIREBASE_SERVICE_ACCOUNT_JSON`** to the full JSON content (one line). The backend will use that instead of a file path.
