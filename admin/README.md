# Golden Labs Admin Panel

Standalone app for admins. Host it separately (e.g. admin.yoursite.com).

## How it works (no Firestore in admin panel)

- **Admin panel** only talks to your **backend API**. It does **not** connect to Firestore or Firebase.
- **Backend** has Firebase/Firestore credentials in **backend** `.env`. The backend reads the `admins` collection to check who can sign in.
- Flow: **Admin panel** → connect wallet → sign message → **Backend** (`/api/auth/admin-login`) → Backend checks **Firestore** `admins` collection → returns JWT → Admin panel uses JWT for `/api/admin/*`.

So you do **not** add Firestore or Firebase details to the admin panel `.env`. Only the backend needs them.

## Admin panel .env

```env
# Backend API URL (same backend as the main platform)
VITE_API_URL=http://localhost:3001/api
```

For production, set `VITE_API_URL` to your backend URL (e.g. `https://api.yoursite.com/api`).

## Backend: Firestore and admin wallet

1. **Backend** `.env` must have Firebase configured (already used for users/storage):
   - `FIREBASE_SERVICE_ACCOUNT_PATH=./keys/your-key.json` or `FIREBASE_SERVICE_ACCOUNT_JSON=...`

2. **Seed the admin** in Firestore (run once from backend folder):
   ```bash
   cd backend
   npm run seed-admins
   ```
   This creates the `admins` collection and adds `0xBdF976981242e8078B525E78784BF87c3b9Da4cA` as an admin.

3. Or create manually in **Firebase Console** → Firestore → Start collection → Collection ID: `admins` → Add document with Document ID: `0xbdf976981242e8078b525e78784bf87c3b9da4ca` (lowercase), field `wallet` (string, same value).

After that, that wallet can connect in the admin panel and sign in.

## Run locally

```bash
npm install
npm run dev
```

Open the URL shown (e.g. http://localhost:5174). Connect the admin wallet and sign the message.
