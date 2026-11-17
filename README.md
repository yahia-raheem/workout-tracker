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

> **On phones:** Google's file picker needs third-party cookies. Every iPhone browser and Safari on Mac block them by default, and some Android browsers do too. The app recognises the browser and shows step-by-step fix instructions before opening the picker (iPhone, Safari), when the picker reports an error, or when you close it without picking. The setting can be switched back once the sheet has been picked. After a sheet has been picked once with a Google account, on any device, its link can be pasted into "Or paste the sheet's link" without the picker.

> While the app is in Testing mode, Google shows a "Google hasn't verified this app" screen. Click **Continue**. Sign-ins only last about an hour, after which the app asks you to sign in again; your entries are kept.

## Publish on GitHub Pages

1. Create a repo (e.g. `workout-log`) and push `index.html` and this README.
2. **Settings → Pages → Deploy from a branch → `main` / root**.
3. Your app will be at `https://<username>.github.io/workout-log/`. Make sure `https://<username>.github.io` is in the OAuth client's JavaScript origins and in the API key's website restrictions (step 4 and 5).

## Insights

The **Insights** tab (next to **Log workout**, in PT mode only) builds dashboards from your sheet. Everything is calculated in the browser each time you open it, or when you tap **↻ Refresh**:

- **Highlights**: plain-language takeaways, such as workouts per week vs the 4 weeks before, the next day in your rotation, days you haven't trained in a while, exercises where you hit every target rep (ready to go heavier), your most improved and stalled lifts, how your sets split across muscle groups, and body changes since your first measurement.
- **Summary tiles and Workouts per week**, for the last 4 weeks, the last 12 weeks or all time.
- **Current plan**: how many times you've done each day of the plan in the Plan tab, when you last did it, and what share of the planned sets you logged.
- **Exercise progress**: a trend line for every exercise, using the estimated 1-rep max (Epley: weight × (1 + reps ÷ 30)) or best reps for bodyweight and timed moves, with a status badge.
- **Exercise trends**: pick a category and an exercise to see its top-set, estimated 1-rep max and volume charts.

The same status shows on each exercise card in **Log workout** (Go heavier, New best or Stalled), so you see it while training without opening Insights.
- **Sets per muscle group**, per week.
- **Body**: latest values and changes from the *Body Data* tab (weight, body fat, lean and fat mass, waist, waist-to-height), plus trend charts. The app looks for a header row with at least `Date` and `Weight`.

Every chart has hover/tap tooltips and a **Show data** table.

## PT mode

Insights are for the PT (and the owner) only. On the sign-in screen, or the sheet screen, tick **PT mode** and enter the PT password. The device then stays in PT mode until you choose **Exit PT mode** in the menu, or **Turn off** on the sign-in screen.

- Without PT mode there are no Insights or Plan tabs, and `insights.js` (dashboards) and `planner.js` (plan editor) are never loaded into the page.
- The Go heavier / New best / Stalled hints on the Log workout cards come from `progress.js` and show for everyone.
- The password itself is not stored anywhere. `pt-config.json` holds only a PBKDF2-SHA256 hash of it (310,000 iterations, random salt).
- This is a lock against ordinary users, not a security boundary. The site is static, so someone technical could still open the dashboards with browser tools.
- To try it without a password: `?demo` shows the trainee view and `?demo&pt` shows the PT view.

**Changing the password.** Run this, then replace `pt-config.json` with its output and push. Every device in PT mode is locked again until the new password is entered.

```bash
python3 -c "import hashlib,os,base64,json,getpass; s=os.urandom(16); p=getpass.getpass('New PT password: ').encode(); print(json.dumps({'algorithm':'PBKDF2-SHA256','iterations':310000,'salt':base64.b64encode(s).decode(),'hash':base64.b64encode(hashlib.pbkdf2_hmac('sha256',p,s,310000)).decode()},indent=2))"
```

## Plan editor (PT mode)

The **Plan** tab writes the training plan into the open sheet's Plan tab, so the PT can set up each trainee's plan from the app.

- **Edit this plan**: change the current plan and keep its name, so its workout history stays together. You can:
  - add, rename, reorder (← Move / Move →) and delete days;
  - add, change, reorder (↑ ↓) and remove exercises;
  - set **Sets**, **Reps**, **Rest (sec)** and a **Comment** for each exercise.
- **Create a new plan**: give it a new name, and start from a copy of the current plan or an empty one. *Keep a copy of the current plan* (on by default) first copies the old plan into a **Plan Archive** tab, which is created the first time. Each row records the plan name and the date it was archived.
- Exercises are picked from the **Settings** tab, so names match the history. Their video links come along automatically.
- Before anything is written, **Save plan** shows a review: every change, problems that block saving (no plan name, a day without exercises, sets not 1–20), and warnings such as missing reps.
- Rest is saved in seconds. Older plans used small numbers for minutes (1 = 1 minute); the editor shows those as seconds (60) and saves them that way.
- Unsaved plan changes stay on the device. If the page reloads, the editor picks up where it left off.
- After saving, logging, the next-day choice and Insights use the new plan right away. Trainees get it the next time they open the app.

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
