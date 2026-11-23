'use strict';
/* =====================================================================
   Workout Log · demo data (loaded only for ?demo)
   A made-up sheet in memory: plan, library, ~14 weeks of history with cardio,
   body data, and a diet plan with two weeks of log. ?demo&nodiet leaves the
   diet out. Nothing is sent anywhere.
   ===================================================================== */
const DAY_MS_DEMO = 864e5;
const DemoSource = (() => {
  const P = (d, c, e, s, r, rest, n, v) => ['', d, c, e, s, r, rest, n, v];
  const yt = id => id ? 'https://youtube.com/shorts/' + id : '';
  const plan = [
    ['', 'Trainee Workout Planner'], [], ['', 'Plan Name:', 'upper A - lower A - upper B - lower B ', '', 'Weekly Cardio (min):', 120],
    ['', 'Day', 'Category', 'Exercise', '# Sets', 'Target Reps', 'Rest', 'Notes', 'Exercise Video link'],
    P('upper A', 'mobility', 'thoracic mobility', 1, 15, 1, '', 'https://www.youtube.com/watch?v=hhvHpsxKjXw'),
    P('upper A', 'chest', 'neutral grip incline db press', 3, 10, 120, '', yt('OJMnnGUbjzM')),
    P('upper A', 'back', 'chest supported db row', 3, 12, 90, '', yt('2ByilQ4NaAs')),
    P('upper A', 'arms', 'triceps overhead', 4, 15, 60, '', yt('9Ark9S11uXw')),
    P('upper A', 'shoulder', 'bottom up kettlebell carry', 3, 20, 90, '20 متر لكل يد', yt('mLyUd0Dsim4')),
    P('lower A', 'mobility', '90 90', 1, 30, 1, '', 'https://www.youtube.com/watch?v=t4Zz6-aG8Iw'),
    P('lower A', 'legs', 'spanish squats', 3, 15, 90, 'استخدم استك خلف الركبة لتخفيف الضغط علي الوتر', yt('YiloyW-QDig')),
    P('lower A', 'legs', 'bulgrian split squat', 3, 10, 90, 'لكل رجل', yt('or1frhkjBDc')),
    P('lower A', 'legs', 'lying leg curl', 3, 10, 90, '', ''),
    P('lower A', 'legs', 'calf raise machine', 3, 15, 1, 'ثبات ثانية في الاغلي', yt('1cvpm--Y-4I')),
    P('upper B', 'chest', 'flat dumbell floor press', 4, 10, 90, '', yt('k8fvMnz42-g')),
    P('upper B', 'shoulder', 'lateral raise DB', 3, 15, 90, '', yt('iK22GwXJji0')),
    P('lower B', 'legs', 'romanian deadlift', 3, 10, 120, '', ''),
    P('lower B', 'legs', 'hip thrust machine', 4, 12, 90, '', yt('sxOrVuCvWq4')),
  ];
  const settings = [['Category', 'Exercise', 'Video Link'],
    ...plan.slice(4).map(r => [r[2], r[3], r[8]]),
    ['arms', 'hammer curl', 'https://www.youtube.com/shorts/VuEclXR7sZY'],
    ['core', 'plank', 'https://www.youtube.com/shorts/xe2MXatLTUw'],
    ['core', 'side plank', 'https://youtube.com/shorts/Ye7G1wQCMgk'],
    ['shoulder', 'face pull', 'https://youtube.com/shorts/zi7waeqXpzw'],
    ['cardio', 'incline treadmill', 'https://youtube.com/shorts/HwXYMPGjlUg'],
    ['cardio', 'bike', ''], ['cardio', 'elliptical', '']];
  // ~14 weeks of generated history so the Insights view has something to show.
  const PLAN = 'upper A - lower A - upper B - lower B ';
  const rnd = (seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; })(7);
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const base = { 'neutral grip incline db press': [14, .015, 2], 'chest supported db row': [14, .012, 2], 'triceps overhead': [7, .01, 1],
    'bottom up kettlebell carry': [6, .008, 2], 'bulgrian split squat': [8, .02, 2], 'lying leg curl': [18, .012, 1], 'calf raise machine': [120, .01, 5],
    'flat dumbell floor press': [16, .015, 2], 'lateral raise DB': [5, 0, 1], 'romanian deadlift': [30, .02, 2.5], 'hip thrust machine': [40, .02, 5] };
  const history = [['', '', 'Trainee Workout Historical Data'], [], [],
    ['', 'Date', 'Day', 'Category', 'Exercise', 'Set', 'Target Reps', 'Actual Reps', 'Target Wgt', 'Actual Wgt', 'Notes', 'Plan Name']];
  const now = new Date(); const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const W = 14;
  // an older plan, to check that only the current plan counts in "Current plan"
  for (let k = 0; k < 6; k++) {
    const d = new Date(mon); d.setDate(d.getDate() - (W + 3) * 7 + k * 4);
    [1, 2, 3].forEach(s => history.push(['', iso(d), 'Day ' + (k % 4 + 1), 'Legs', 'Leg Press Machine', s, 12, 12, 90 + k * 5, 90 + k * 5, '', 'First Plan']));
  }
  const offsets = { 'upper A': 0, 'lower A': 1, 'upper B': 3, 'lower B': 4 };
  const rows = plan.slice(4);
  for (let w = W; w >= 0; w--) {
    for (const [day, off] of Object.entries(offsets)) {
      const d = new Date(mon); d.setDate(d.getDate() - w * 7 + off);
      if (d > now || rnd() < (day === 'lower B' ? 0.35 : 0.12)) continue;     // skipped sessions
      const prog = W - w;
      rows.filter(r => r[1] === day).forEach(r => {
        const [, , cat, ex, sets, reps] = r; const b = base[ex];
        let wt = b ? Math.round(b[0] * (1 + b[1] * prog) / b[2]) * b[2] : 0;
        if (ex === 'lateral raise DB') wt = prog < 6 ? 4 : 5;
        for (let s = 1; s <= sets; s++) {
          let ar = reps - (s > 1 && rnd() < 0.45 ? Math.ceil(rnd() * 3) : 0);
          if (w === 0 && ['neutral grip incline db press', 'calf raise machine'].includes(ex)) ar = reps;   // ready to go heavier
          if (ex === 'lateral raise DB' && prog > 8) ar = 12;
          history.push(['', iso(d), day, cat, ex, s, reps, ar, wt, wt, ar < reps - 2 ? 'Failure' : '', PLAN]);
        }
      });
    }
  }
  // "Other" cardio sessions: 0–3 a week, minutes in Actual Reps, details in Notes
  const CARDIO = [['incline treadmill', m => `${(m * 0.09).toFixed(1)} km, incline ${6 + Math.round(rnd() * 4)}`], ['bike', () => `level ${7 + Math.round(rnd() * 4)}`], ['elliptical', () => `level ${5 + Math.round(rnd() * 3)}`]];
  for (let w = W; w >= 0; w--) {
    const n = 2 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const d = new Date(mon); d.setDate(d.getDate() - w * 7 + [2, 5, 6, 3][k]);
      if (d > now) continue;
      const [ex, det] = CARDIO[Math.floor(rnd() * CARDIO.length)], min = 30 + Math.round(rnd() * 6) * 5;
      history.push(['', iso(d), 'Other', 'cardio', ex, 1, '', min, '', '', det(min), PLAN]);
    }
  }
  history.splice(4, history.length - 4, ...history.slice(4).sort((a, b) => a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));   // by date, like a real log
  // Body Data, laid out like the real tab (inputs on top, table from row 10)
  const body = [[], ['', 'Body Measurements'], ['', 'Biological Sex', 'Male'], ['', 'Height (cm)', 162], ['', 'Measurement System', 'Metric'], [], [], [], [],
    ['', 'Date', 'Chest', 'Waist', 'Left Leg', 'Right Leg', 'Left Arm', 'Right Arm', 'Neck', 'Weight (kg)', 'Hips (cm)', 'BMI', 'Body Fat %', 'WHtR', 'Fat Mass (kg)', 'Lean Body Mass (kg)', 'WHR']];
  for (let k = 0; k < 6; k++) {
    const d = new Date(mon); d.setDate(d.getDate() - (W - k * 2.6) * 7);
    const waist = 82 - k * 0.6, neck = 38, wt = 69.5 - k * 0.35, hips = 98 - k * 0.3;
    const bf = (495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(162)) - 450) / 100;
    body.push(['', iso(d), 97 + k * 0.4, waist, 56.5 + k * 0.3, 56.5 + k * 0.35, 33 + k * 0.2, 33.2 + k * 0.2, neck, +wt.toFixed(1), hips,
      +(wt / 1.62 ** 2).toFixed(2), +bf.toFixed(4), +(waist / 162).toFixed(2), +(wt * bf).toFixed(2), +(wt * (1 - bf)).toFixed(2), +(waist / hips).toFixed(2)]);
  }
  // Diet: Foods (per 100 g), a Diet Plan, and ~2 weeks of Diet Log
  const foods = [['Food', 'Group', 'kcal /100g', 'Protein /100g', 'Carbs /100g', 'Fat /100g', 'Unit', 'Grams per unit'],
    ['chicken breast (cooked)', 'protein', 165, 31, 0, 3.6, '', ''], ['egg', 'protein', 143, 12.6, 0.7, 9.5, 'egg', 55],
    ['tuna (in water)', 'protein', 116, 26, 0, 1, 'can', 120], ['white fish (grilled)', 'protein', 128, 26, 0, 2.7, '', ''],
    ['lean beef (cooked)', 'protein', 217, 26, 0, 12, '', ''], ['whey protein', 'protein', 390, 78, 8, 5, 'scoop', 30],
    ['cottage cheese', 'dairy', 98, 11, 3.4, 4.3, '', ''], ['greek yogurt', 'dairy', 59, 10, 3.6, 0.4, 'cup', 170],
    ['عيش بلدي (baladi bread)', 'carbs', 250, 8.5, 50, 1.2, 'loaf', 90], ['rice (cooked)', 'carbs', 130, 2.7, 28, 0.3, '', ''],
    ['oats', 'carbs', 389, 17, 66, 7, '', ''], ['potato (boiled)', 'carbs', 87, 1.9, 20, 0.1, '', ''],
    ['pasta (cooked)', 'carbs', 158, 5.8, 31, 0.9, '', ''], ['foul medames', 'carbs', 110, 7.6, 19.7, 0.4, '', ''],
    ['banana', 'fruit', 89, 1.1, 23, 0.3, 'banana', 120], ['apple', 'fruit', 52, 0.3, 14, 0.2, 'apple', 180],
    ['mixed salad', 'veg', 20, 1, 3.5, 0.2, '', ''], ['broccoli', 'veg', 34, 2.8, 7, 0.4, '', ''],
    ['olive oil', 'fats', 884, 0, 0, 100, 'tbsp', 13], ['peanut butter', 'fats', 588, 25, 20, 50, 'tbsp', 16]];
  const dStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 15);
  const DIET = 'Cut – Nov';
  const dietPlan = [['Kind', 'Meal', 'Item', 'Value', 'Unit', 'kcal', 'Protein', 'Carbs', 'Fat', 'Notes'],
    ['Plan', '', DIET, iso(dStart)], ['Daily', '', '', '', '', 'max 2200', 'min 160', 'max 220', 'max 70'],
    ['Cheat', '', '', 1, '2 weeks'], ['Water', '', '', 8, 'glasses'],
    ['Supplement', '', 'Creatine', '5 g', '', '', '', '', '', 'daily'], ['Supplement', '', 'Whey', '1 scoop', '', '', '', '', '', 'after training'],
    ['Meal', 'Breakfast', '', '', '', 'max 600', 'min 35', 'max 60', 'max 22'],
    ['Planned', 'Breakfast', 'egg', 3, 'egg'], ['Planned', 'Breakfast', 'عيش بلدي (baladi bread)', 1, 'loaf'], ['Planned', 'Breakfast', 'cottage cheese', 100, 'g'],
    ['Allowed', 'Breakfast', 'group: protein'], ['Allowed', 'Breakfast', 'oats'], ['Allowed', 'Breakfast', 'banana'],
    ['Meal', 'Lunch', '', '', '', 'max 650', 'min 45', 'max 70', 'max 20'],
    ['Planned', 'Lunch', 'chicken breast (cooked)', 150, 'g'], ['Planned', 'Lunch', 'rice (cooked)', 200, 'g'], ['Planned', 'Lunch', 'mixed salad', 200, 'g'],
    ['Allowed', 'Lunch', 'group: protein'], ['Allowed', 'Lunch', 'group: carbs'], ['Allowed', 'Lunch', 'group: veg'],
    ['Meal', 'Pre-workout', '', '', '', 'max 400', 'min 20', 'max 60', 'max 12'],
    ['Planned', 'Pre-workout', 'banana', 1, 'banana'], ['Planned', 'Pre-workout', 'greek yogurt', 1, 'cup'], ['Planned', 'Pre-workout', 'oats', 30, 'g'],
    ['Allowed', 'Pre-workout', 'group: fruit'], ['Allowed', 'Pre-workout', 'whey protein'],
    ['Meal', 'Dinner', '', '', '', 'max 550', 'min 45', 'max 45', 'max 20'],
    ['Planned', 'Dinner', 'white fish (grilled)', 200, 'g'], ['Planned', 'Dinner', 'potato (boiled)', 150, 'g'], ['Planned', 'Dinner', 'broccoli', 150, 'g'],
    ['Allowed', 'Dinner', 'group: protein'], ['Allowed', 'Dinner', 'group: veg'], ['Allowed', 'Dinner', 'rice (cooked)']];
  const F = new Map(foods.slice(1).map(f => [f[0], f]));
  const line = (date, meal, status, food, amount, unit, notes = '') => {
    if (!food) return [date, meal, status, '', '', '', '', '', '', '', '', notes, DIET, date + ' 22:00'];
    const f = F.get(food), g = unit === 'g' ? amount : amount * f[7], k = x => Math.round(x * g / 100 * 10) / 10;
    return [date, meal, status, food, amount, unit, g, Math.round(f[2] * g / 100), k(f[3]), k(f[4]), k(f[5]), notes, DIET, date + ' 22:00'];
  };
  const planned = meal => dietPlan.filter(r => r[0] === 'Planned' && r[1] === meal).map(r => [r[2], r[3], r[4]]);
  const dietLog = [['Date', 'Meal', 'Status', 'Food', 'Amount', 'Unit', 'Grams', 'kcal', 'Protein', 'Carbs', 'Fat', 'Notes', 'Diet Plan', 'Saved at']];
  for (let d = new Date(dStart); d < new Date(now.getFullYear(), now.getMonth(), now.getDate()); d.setDate(d.getDate() + 1)) {
    const ds = iso(d), back = Math.round((now - d) / DAY_MS_DEMO);
    for (const meal of ['Breakfast', 'Lunch', 'Pre-workout', 'Dinner']) {
      const x = rnd();
      if (meal === 'Dinner' && (back === 11 || back === 3)) { dietLog.push(line(ds, meal, 'cheat', '', '', '', back === 3 ? 'koshari large + rice pudding' : 'pizza, 2 slices')); continue; }
      if (x < 0.07) { dietLog.push(line(ds, meal, 'skipped', '')); continue; }
      if (x < 0.30) {      // adjusted: bigger carb portion or a swap
        planned(meal).forEach(([f, a, u]) => {
          const g = F.get(f)[1];
          if (g === 'carbs' && u === 'g') dietLog.push(line(ds, meal, 'adjusted', f, Math.round(a * 1.35 / 10) * 10, u));
          else if (f === 'white fish (grilled)') dietLog.push(line(ds, meal, 'adjusted', 'chicken breast (cooked)', 170, 'g'));
          else dietLog.push(line(ds, meal, 'adjusted', f, a, u));
        });
        continue;
      }
      planned(meal).forEach(([f, a, u]) => dietLog.push(line(ds, meal, 'planned', f, a, u)));
    }
    const sup = n => [ds, 'Supplement', 'taken', n, '', '', '', '', '', '', '', '', DIET, ds + ' 22:00'];
    if (rnd() < 0.9) dietLog.push(sup('Creatine'));
    if (d.getDay() % 2 === 1) dietLog.push(sup('Whey'));
    dietLog.push([ds, 'Water', 'water', '', 4 + Math.round(rnd() * 4), 'glasses', '', '', '', '', '', '', DIET, ds + ' 22:00']);
  }
  const book = { title: 'Demo — Workout Tracker', tabs: { 'Plan': plan, 'Settings': settings, 'Historical Data': history, 'Body Data': body, 'Tracker': [],
    ...(new URLSearchParams(location.search).has('nodiet') ? {} : { 'Foods': foods, 'Diet Plan': dietPlan, 'Diet Log': dietLog }) } };
  window.__demoBook = book;   // for tests and the "rows written" view
  const ids = { 'Plan': 1, 'Settings': 2, 'Historical Data': 3, 'Body Data': 4, 'Tracker': 0 };
  const tabOf = range => range.match(/^'((?:[^']|'')+)'!/)[1].replace(/''/g, "'");
  return {
    async meta() { await sleep(250); return { title: book.title, sheets: Object.keys(book.tabs).map(t => ({ title: t, sheetId: ids[t], rowCount: Math.max(1000, book.tabs[t].length) })) }; },
    async batchGet(id, ranges) {
      await sleep(250);
      return ranges.map(r => { const t = book.tabs[tabOf(r)]; if (!t) throw Object.assign(new Error('Unable to parse range: ' + r), { status: 400 }); return t.map(row => row.map(c => String(c ?? ''))); });
    },
    async batchGetRaw(id, ranges) { await sleep(250); return ranges.map(r => book.tabs[tabOf(r)].map(row => row.slice())); },
    async addRows() {},
    async addSheet(id, title) { await sleep(200); book.tabs[title] = []; ids[title] = Math.max(...Object.values(ids)) + 1; return ids[title]; },
    async update(id, range, values) {
      await sleep(300);
      const tab = book.tabs[tabOf(range)];
      const [, col, row] = range.match(/!([A-Z]+)(\d+)/);
      const c0 = col.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      values.forEach((r, k) => { const target = tab[Number(row) - 1 + k] = tab[Number(row) - 1 + k] || []; r.forEach((v, x) => { if (v !== null) target[c0 + x] = v; }); });
      window.__demoBook = book;
    },
  };
})();

