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

## Rest timer

Each set's number is also its **done** button. Tap **1**, **2**, **3**… when you finish a set:

- It turns into a lime ✓. If the set was empty, the plan's reps and last time's weight are filled in.
- A rest countdown starts at the bottom, using that exercise's rest time from the plan (90 s if the plan has none). **+15s** adds time and **Skip** ends it.
- Changing reps or weight on a ticked set restarts its timer. Tapping ✓ again un-ticks it and stops the timer.
- When rest is over: three beeps, a vibration (Android), and the bar flashes "Rest over · Next: …".
- The screen is kept awake while a timer runs, so the alert fires on time. A running timer survives a page reload.
- **Notifications**: the first time a timer runs, the bar offers to send a notification when rest ends, for when the app isn't on screen. This is best effort, because phones pause web pages in the background: on Android it can be up to about a minute late, and on iPhone it needs the app to be installed (below).

## Install as an app

The app can be installed with its own icon. It then opens full screen, and on iPhone this is also what makes background notifications possible.

- **Android (Chrome)**: tap **Install** on the banner, or ☰ → **Install as an app**.
- **iPhone / iPad**: tap **Install** for the steps: Share → **Add to Home Screen** → Add.
- Installed apps keep their own storage, so the first time you open the icon you sign in with Google again (and re-enter the PT password if you use PT mode).
- `sw.js` keeps a copy of the app's own files (never Google's, never sheet data), so the app opens fast and even offline after one visit. The page is always fetched fresh when online, and scripts are loaded as `file.js?v=<version>`, so updates still show up on the next open.

## Plan files (PT mode)

- **Plan tab → ⤓ Export this plan as a file** saves the current plan as a `.json` file. On a phone it opens the share sheet (WhatsApp, Files…); on a computer it downloads.
- **Create a new plan → A plan file** opens such a file in the editor, for example to give the same plan to another trainee. The name is taken from the file and can be changed. Exercises missing from this sheet's Settings tab are flagged in the review.

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
- **Bring back an archived plan**: in *Create a new plan*, choose *A plan from the archive* and pick one; it lists the newest first. It opens in the editor with its days, exercises and settings. Its old name is filled in: keep it to continue that plan's history in Insights, or change it to start a separate history. The plan it replaces is archived as usual.
- Exercises are picked from the **Settings** tab, so names match the history. Their video links come along automatically.
- Before anything is written, **Save plan** shows a review: every change, problems that block saving (no plan name, a day without exercises, sets not 1–20), and warnings such as missing reps.
- Rest is saved in seconds. Older plans used small numbers for minutes (1 = 1 minute); the editor shows those as seconds (60) and saves them that way.
- Unsaved plan changes stay on the device. If the page reloads, the editor picks up where it left off.
- After saving, logging, the next-day choice and Insights use the new plan right away. Trainees get it the next time they open the app.

## PT targets (PT mode)

The **Targets** tab lets the PT set reps and weight per set for any day of the plan, at the gym together or in advance.

- It opens on the trainee's **next** session (the day after the last one logged under the current plan), marked *· next*. Tap another day to set its targets.
- For each set: reps, kg and an optional note. *+ Set / − Set* change the number of sets for that session, and *Copy set 1 to all* fills the rest. Exercises left empty get no targets.
- **Save <day>** writes that day to a **PT Targets** tab (created the first time). The tab holds at most one block per plan day: saving a day replaces only that day's block.
- Day buttons show a filled purple dot when a day has targets waiting, and a hollow one when its last targets were used.
- **↺ Reuse last targets** (on a day whose targets were used) copies them back in, including set count and notes. **+2.5 kg on all** adds 2.5 kg to every set with a weight. Neither is saved until *Save*.
- The trainee's app shows them on the logging screen with a purple **PT TARGETS** label: the PT's numbers replace the *Previous* column (last time is shown underneath), and ticking ✓ on an empty set fills them in. The *Go heavier / Stalled* hints are hidden on those exercises.
- While the logging screen is open, the app checks for new targets every 30 seconds (or right away with *↻ Refresh*). Changed sets are outlined for a moment; anything the trainee already typed is never overwritten.
- When the trainee saves the workout, sets with a PT target are written with the PT's numbers in **Target Reps / Target Wgt** and `PT target` in **Notes**, and that day's block gets a **Used on** date, so the trainee no longer sees it. Targets also stop showing once that day is logged on a later date, or when a new plan is saved.

## Other sessions and cardio

- **Other session**: on the logging screen, *Doing something else today? Log an Other session* opens an empty session for off-plan work (e.g. just cardio). Add exercises from the library (the picker opens on the cardio category). It's saved with **Day = Other**, which isn't a plan day, so the plan's next day doesn't move. After saving, the app goes back to the plan.
- **Cardio cards**: exercises in the **cardio** category show **Minutes** and **Details** instead of reps and kg. Minutes go in **Actual Reps**, details (distance, incline, level…) in **Notes**, and the weight columns stay empty. Ticking a round doesn't start the rest timer.
- **Weekly cardio target** (PT, Plan tab → Edit/Create): minutes per week. It's stored on the Plan tab next to the plan name as a `Weekly Cardio (min):` label with the value to its right; the app finds it by the label. The first time, it uses the first two empty cells on the plan-name row (E3:F3 on the standard sheet), never overwriting anything. It's also kept in **Plan Archive** (column *Weekly Cardio (min)*) and in exported plan files.
- **Counting**: every set in the cardio category counts, in plan days and Other sessions. Weeks run **Saturday to Friday**.
- **Trainee**: when the plan has a target, the logging screen shows a *Cardio this week* bar (including unsaved minutes) and the save panel shows where the week stands.
- **Insights** (PT): a Cardio section with this week's bar, *Target met* (full weeks), average minutes per week, streak, and a weekly chart with the target as a dashed line. Without a target it shows minutes per week only.

## Diet (phase 1)

Three new tabs in the sheet, created by the app the first time they're needed:

| Tab | Columns |
|---|---|
| **Foods** | `Food, Group, kcal /100g, Protein /100g, Carbs /100g, Fat /100g, Unit, Grams per unit` |
| **Diet Plan** | `Kind, Meal, Item, Value, Unit, kcal, Protein, Carbs, Fat, Notes`, one row per setting: `Plan` (name, start date), `Daily` (limits), `Cheat` (N, "X weeks"), `Water` (glasses), `Supplement`, `Meal` (limits), `Planned` (food, amount, unit), `Allowed` (food or `group: protein`). Limits are written `max 550`, `min 40` or `target 2200` (±10%). |
| **Diet Log** | `Date, Meal, Status, Food, Amount, Unit, Grams, kcal, Protein, Carbs, Fat, Notes, Diet Plan, Saved at`. Status is `planned`, `adjusted`, `skipped`, `cheat`, `taken` (Meal = Supplement) or `water` (Meal = Water). |

**PT (Plan tab → Diet plan / Foods):**
- **Foods**: values per 100 g with an optional unit (e.g. 1 egg = 55 g). The form checks protein × 4 + carbs × 4 + fat × 9 against the calories. The group is used for swaps. Foods used in the plan can't be deleted; renaming a food updates the plan.
- **Diet planner**: plan name, daily targets (≤ max, ≥ min, ≈ target ±10%), cheat meals (N in any X weeks, rolling), water, supplements, and meals with limits, planned foods ("As planned") and extra allowed foods or whole groups.
- **New diet plan…** (copy or empty) asks for confirmation and then **deletes the Diet Log** (the old plan's meals, supplements and water). Foods are kept. Editing the current plan keeps the log.
- **Food files** (Foods screen): *Export all foods* saves the whole Foods list to one file; *Import foods* adds the foods this sheet doesn't have and **skips existing ones** (they keep their values). A diet file can be imported here too, for its foods only.
- **Diet files** (Diet plan screen): export the plan with the foods it uses. Importing one adds missing foods and **overwrites existing foods with the plan's values** (shown before anything is written), then opens the plan as a new plan. Meals already logged keep the values they were saved with.
- **Insights → Diet**: current plan only: meals on target, average calories and protein, cheat meals vs allowance, calories and protein per day, a by-meal table (most frequent miss), supplements and water, and body weight since the plan started (from Body Data).

**Trainee (Diet tab, only when the sheet has a diet plan):** day navigation (back to the plan's start), daily totals against targets, cheat-meal allowance (rolling), and each meal as **As planned / Adjust / Skipped / Cheat**. Adjust only offers foods the PT allows for that meal; **Swap** stays within the food's group and suggests the amount that keeps the same protein (or carbs, fat, calories). Each meal is saved on its own; supplements and water save as you tap. The diet code only loads for sheets with a diet plan.

## Privacy policy

`privacy.html` is the app's privacy policy, linked from the sign-in screen, the footer and the menu. Use its address (`https://<username>.github.io/workout-tracker/privacy.html`) as the **Privacy policy link** in Google Auth Platform → Branding, and the app's address as the **Application home page**.

## How it reads and writes your sheet

| Tab | What the app uses |
|---|---|
| **Plan** | The header row with `Day, Category, Exercise, # Sets, Target Reps, Rest, Notes, Exercise Video link`, and the `Plan Name:` cell above it |
| **PT Targets** | Optional, created by the PT: `Day, Exercise, Set, Reps, Weight, Note, Plan Name, Saved at, Used on`, one block per plan day |
| **Settings** | `Category, Exercise, Video Link`: the library for ad-hoc exercises and fallback videos |
| **Historical Data** | Reads the history for "Previous" values; writes one row per logged set to `Date, Day, Category, Exercise, Set, Target Reps, Actual Reps, Target Wgt, Actual Wgt, Notes, Plan Name` |

- Header rows are found automatically (anywhere in the first 20 rows) and columns are matched by name, so moving a column doesn't break anything.
- New rows go directly below the last used row of Historical Data. If the tab is full, the app adds rows first.
- **Target Wgt** is the weight you used for that set last session. If you have no previous session for it, the app uses the weight you just entered.
- **Rest**: values up to 5 are shown as minutes, larger values as seconds (your Plan currently mixes `1` and `90`).
- Ad-hoc exercises are saved under the selected day like planned ones. Nothing in the row marks them as extra.
- Your existing formulas (Prev Session Data, Calc_Muscle_Max, dashboards) keep working, because the rows match what the old save script wrote.

## Development

- **Demo mode:** `?demo` (trainee), `?demo&pt` (PT), `?demo&nodiet` (no diet plan). The demo data lives in `demo.js`, which only loads in demo mode.
- **Before every push:**
  1. `python3 tools/stamp.py`: writes the scripts' version (a hash of their contents) into `index.html`. Without it, phones keep using the cached scripts.
  2. `python3 tests/run.py`: runs every journey (logging, saving and sign-in errors, rest timer, Other/cardio, PT unlock, Insights, plan editor and files, PT targets, diet tracker and planner, foods files, offline) in a phone-sized browser. Needs `pip install playwright && playwright install chromium`. It also fails if step 1 was forgotten.
- Historical Data and Body Data are read once when a sheet opens (unformatted values); the logging screen, hints and Insights share that copy until something is saved.

