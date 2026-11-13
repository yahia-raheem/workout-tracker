# Workout Log

A one-page web app for logging workouts straight into your Google Sheet tracker. It writes to the **Historical Data** tab, so you don't need the Tracker tab.

- Sign in with Google and pick your tracker sheet from Drive.
- The app checks the sheet's format: required tabs, header columns, plan days, and whether plan exercises exist in the Settings library.
- Pick a day from the Plan, log reps, weight and a note per set, and see what you did last session.
- Add an exercise that isn't in today's plan (chosen from the Settings library).
- Watch each exercise's video inside the app.
- Unsaved entries are kept on the device, so a refresh or a dead phone screen won't lose them.

## Try it without Google first

```bash
cd workout-logger
python3 -m http.server 8000
```

Open <http://localhost:8000/?demo>. Demo mode uses sample data and shows you the rows it *would* write.

## One-time Google Cloud setup (about 10 minutes)

1. Go to <https://console.cloud.google.com> and **create a project** (e.g. "Workout Log").
2. **APIs & Services → Library**: enable **Google Sheets API**, **Google Drive API** and **Google Picker API**.
3. **Google Auth Platform / OAuth consent screen**:
   - User type: **External**. Fill in the app name and your email.
   - Scopes: add `.../auth/drive.file`. This scope only lets the app access files you pick, and Google treats it as non-sensitive, so no verification is needed.
   - **Audience → Test users**: add your Gmail, and later each trainee's Gmail (up to 100 while the app is in "Testing").
4. **Credentials → Create credentials → OAuth client ID**:
   - Type: **Web application**
   - Authorized JavaScript origins:
     - `http://localhost:8000`
     - `https://<your-github-username>.github.io` (add this when you publish)
   - Copy the **Client ID**.
5. **Credentials → Create credentials → API key**. Restrict it:
   - Application restrictions: **Websites**, with `http://localhost:8000/*` and `https://<your-github-username>.github.io/*`
   - API restrictions: **Google Picker API** only
6. **Project number**: open the project dashboard (or IAM & Admin → Settings) and copy the numeric *Project number*.
7. Open `index.html` and fill in the block at the top of the script:

```js
const CONFIG = {
  CLIENT_ID: '1234567890-abc.apps.googleusercontent.com',
  API_KEY:   'AIza...',
  APP_ID:    '1234567890',   // project number
};
```

These values are safe to put in a public page. The client ID is public by design, and the API key is locked to your sites and to the Picker.

Run `python3 -m http.server 8000` again, open <http://localhost:8000>, sign in, and pick your tracker.

> **On phones:** Google's file picker often fails in mobile browsers because it needs third-party cookies. Pick the sheet once on a computer, then on the phone paste the sheet's link into "Or paste the sheet's link". Access is tied to your Google account, not the device.

> While the app is in Testing mode, Google shows a "Google hasn't verified this app" screen. Click **Continue**. Sign-ins only last about an hour, after which the app asks you to sign in again; your entries are kept.

## Publish on GitHub Pages

1. Create a repo (e.g. `workout-log`) and push `index.html` and this README.
2. **Settings → Pages → Deploy from a branch → `main` / root**.
3. Your app will be at `https://<username>.github.io/workout-log/`. Make sure `https://<username>.github.io` is in the OAuth client's JavaScript origins and in the API key's website restrictions (step 4 and 5).

## Privacy policy

`privacy.html` is the app's privacy policy, linked from the sign-in screen, the footer and the menu. Use its address (`https://<username>.github.io/workout-tracker/privacy.html`) as the **Privacy policy link** in Google Auth Platform → Branding, and the app's address as the **Application home page**.

## How it reads and writes your sheet

| Tab | What the app uses |
|---|---|
| **Plan** | The header row with `Day, Category, Exercise, # Sets, Target Reps, Rest, Notes, Exercise Video link`, and the `Plan Name:` cell above it |
| **Settings** | `Category, Exercise, Video Link`: the library for ad-hoc exercises and fallback videos |
| **Historical Data** | Reads the history for "Previous" values; writes one row per logged set to `Date, Day, Category, Exercise, Set, Target Reps, Actual Reps, Target Wgt, Actual Wgt, Notes, Plan Name` |

- Header rows are found automatically (anywhere in the first 20 rows) and columns are matched by name, so moving a column doesn't break anything.
- New rows go directly below the last used row of Historical Data. If the tab is full, the app adds rows first.
- **Target Wgt** is the weight you used for that set last session. If you have no previous session for it, the app uses the weight you just entered.
- **Rest**: values up to 5 are shown as minutes, larger values as seconds (your Plan currently mixes `1` and `90`).
- Ad-hoc exercises are saved under the selected day like planned ones. Nothing in the row marks them as extra.
- Your existing formulas (Prev Session Data, Calc_Muscle_Max, dashboards) keep working, because the rows match what the old save script wrote.
