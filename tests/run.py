#!/usr/bin/env python3
"""Workout Log regression tests (demo mode, phone-sized browser).

    pip install playwright && playwright install chromium
    python3 tests/run.py            # all tests
    python3 tests/run.py diet       # tests whose name contains "diet"

Starts a local web server for the repo, runs each journey in a fresh browser,
fails on any page error. Screenshots go to tests/out/ (not committed).
"""
import json, os, socket, subprocess, sys, time, traceback
from contextlib import contextmanager
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tests', 'out'); os.makedirs(OUT, exist_ok=True)
PHONE = 'iPhone 13'
TESTS = []
def test(fn): TESTS.append(fn); return fn

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

class Env:
    def __init__(self, pw, base): self.pw, self.base, self.browser = pw, base, pw.chromium.launch()
    @contextmanager
    def page(self, query='?demo', phone=True, cont=True, **kw):
        opts = dict(self.pw.devices[PHONE]) if phone else {'viewport': {'width': 1100, 'height': 900}}
        opts.update(timezone_id='Africa/Cairo', accept_downloads=True, **kw)
        ctx = self.browser.new_context(**opts); pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        # network failures (e.g. Google's scripts unreachable from a test machine) aren't app errors
        pg.on('console', lambda m: m.type == 'error' and 'favicon' not in m.text and 'net::ERR' not in m.text and errs.append(m.text))
        if query is not None:
            pg.goto(self.base + query)
            if cont: pg.wait_for_selector('.checks'); pg.click('[data-act=continue]'); pg.wait_for_timeout(500)
        try:
            yield pg
            assert not errs, f'page errors: {errs}'
        finally: ctx.close()

def shot(pg, name, full=False): pg.screenshot(path=os.path.join(OUT, name + '.png'), full_page=full)
def book(pg, tab): return pg.evaluate(f"window.__demoBook.tabs[{json.dumps(tab)}]")
def loaded(pg, f): return pg.evaluate(f"performance.getEntriesByType('resource').some(r => r.name.includes('{f}'))")

# ------------------------------------------------------------------ trainee
@test
def trainee_loads_no_pt_code(E):
    with E.page('?demo') as pg:
        pg.wait_for_selector('.card'); pg.wait_for_selector('.log-hint', timeout=8000)
        assert pg.evaluate('typeof renderInsights') == 'undefined'
        for f in ('insights.js', 'planner.js', 'targets.js', 'dietpt.js'): assert not loaded(pg, f), f
        assert not loaded(pg, 'diet.js'), 'diet.js should wait for the Diet tab'
        assert pg.inner_text('.tabs') .replace('\n', ' ') == 'Log workout Diet'
    with E.page('?demo&nodiet') as pg:
        pg.wait_for_selector('.card')
        assert pg.query_selector('.tabs') is None, 'no diet plan → no tab bar'

@test
def history_read_once(E):
    count = """window.__reads = []; for (const k of ['batchGet', 'batchGetRaw']) { const f = DemoSource[k]; DemoSource[k] = async (id, r) => { window.__reads.push(...r); return f.call(DemoSource, id, r); }; } 0"""
    hist = "window.__reads.filter(r => r.includes('Historical')).length"
    with E.page('?demo') as pg:
        pg.wait_for_selector('.log-hint', timeout=8000)
        assert pg.evaluate('!!state.model.rawData'), 'history kept from the first read'
        pg.evaluate(count); pg.evaluate('INS.data = null; prefetchInsights(); 0'); pg.wait_for_timeout(600)
        assert pg.evaluate(hist) == 0, 'hints must not re-read Historical Data'
        assert pg.evaluate("state.model.historyRows.every(r => /^\\d{4}-\\d{2}-\\d{2}$/.test(r.date))")
        pg.fill('input[data-f=reps][data-i="1"][data-j="0"]', '8'); pg.click('#saveBtn'); pg.click('[data-act=confirm-save]'); pg.wait_for_selector('.result.ok')
        pg.click('[data-act=close]'); pg.wait_for_timeout(800)
        assert pg.evaluate(hist) >= 1, 'after a save the hints re-read the sheet'

@test
def logging_save_and_errors(E):
    def fill(pg):
        pg.fill('input[data-f=reps][data-i="1"][data-j="0"]', '12'); pg.fill('input[data-f=wgt][data-i="1"][data-j="0"]', '20')
        pg.fill('input[data-f=reps][data-i="1"][data-j="1"]', '10'); pg.fill('input[data-f=wgt][data-i="1"][data-j="1"]', '20')
    hl = lambda pg: len(book(pg, 'Historical Data'))
    with E.page('?demo') as pg:
        pg.wait_for_selector('.card'); day0 = pg.evaluate('state.day'); n0 = hl(pg)
        fill(pg); pg.click('#saveBtn'); pg.click('[data-act=confirm-save]'); pg.wait_for_selector('.result.ok')
        rows = book(pg, 'Historical Data')[n0:]
        assert len(rows) == 2 and all(len(str(r[1])) == 10 for r in rows), rows      # date only, YYYY-MM-DD
        pg.mouse.click(10, 60); assert pg.is_visible('.result.ok'), 'result must stay until closed'
        pg.click('.result [data-act=close]')
        assert pg.evaluate('state.day') == day0 and pg.input_value('input[data-f=reps][data-i="1"][data-j="0"]') == ''
        # sign-in expired during save → Sign in & save
        n1 = hl(pg)
        pg.evaluate("window.__upd = DemoSource.update; let once = true; DemoSource.update = async (...a) => { if (once) { once = false; throw new AuthError('expired'); } return __upd(...a); }; 0")
        fill(pg); pg.click('#saveBtn'); pg.click('[data-act=confirm-save]'); pg.wait_for_selector('.result.err')
        assert pg.input_value('input[data-f=reps][data-i="1"][data-j="0"]') == '12'
        pg.click('[data-act=reauth-save]'); pg.wait_for_selector('.result.ok'); assert hl(pg) - n1 == 2
        pg.click('.result [data-act=close]'); n2 = hl(pg)
        # network error after the write landed → retry must not duplicate
        pg.evaluate("let once2 = true; DemoSource.update = async (...a) => { const r = await __upd(...a); if (once2) { once2 = false; throw new Error('Network connection lost'); } return r; }; 0")
        fill(pg); pg.click('#saveBtn'); pg.click('[data-act=confirm-save]'); pg.wait_for_selector('.result.err')
        pg.click('[data-act=retry-save]'); pg.wait_for_selector('.result.ok'); assert hl(pg) - n2 == 2

@test
def next_day_after_save(E):
    with E.page('?demo') as pg:
        pg.wait_for_selector('.card'); days = pg.evaluate('state.model.days'); d = pg.evaluate('state.day')
        pg.evaluate("localStorage.clear()")
        pg.fill('input[data-f=reps][data-i="1"][data-j="0"]', '8'); pg.click('#saveBtn'); pg.click('[data-act=confirm-save]'); pg.wait_for_selector('.result.ok')
        # (a reload would regenerate the demo data, so ask the app directly)
        assert pg.evaluate('nextPlanDay().day') == days[(days.index(d) + 1) % len(days)]
        assert pg.evaluate('suggestDay().day') == days[(days.index(d) + 1) % len(days)]

@test
def rest_timer_and_install(E):
    with E.page('?demo') as pg:
        pg.wait_for_selector('.card'); pg.click('[data-act=day][data-day="lower A"]'); pg.wait_for_timeout(200)
        assert pg.query_selector('#installBanner') is not None
        pg.click('[data-act=done][data-i="2"][data-j="0"]')
        assert pg.input_value('input[data-f=reps][data-i="2"][data-j="0"]') != '' and pg.inner_text('[data-act=done][data-i="2"][data-j="0"]') == '✓'
        pg.wait_for_timeout(1200); t1 = pg.inner_text('#restTime'); pg.click('[data-act=rest-add]'); assert pg.inner_text('#restTime') != t1
        pg.evaluate("REST.t.endAt = Date.now() + 600; scheduleEnd(); 0"); pg.wait_for_timeout(1300)
        assert 'over' in (pg.get_attribute('#restBar', 'class') or '')
        pg.click('[data-act=rest-skip]'); assert pg.is_hidden('#restBar')
        assert pg.evaluate("fetch('manifest.webmanifest').then(r => r.json()).then(j => j.name)")

@test
def other_cardio_session(E):
    with E.page('?demo') as pg:
        pg.wait_for_selector('#cardioMeter .cm'); nxt = pg.evaluate('state.day')
        pg.click('[data-act=other]'); pg.wait_for_selector('#ahCat')
        assert pg.evaluate('state.day') == 'Other' and 'cardio' in pg.eval_on_selector('#ahCat', 'e => e.value')
        pg.select_option('#ahEx', label='incline treadmill'); pg.click('[data-act=adhoc-add]'); pg.wait_for_selector('#card-0')
        pg.fill('input[data-f=reps][data-i="0"][data-j="0"]', '30'); pg.fill('input[data-f=note][data-i="0"][data-j="0"]', '2.7 km, incline 8')
        assert 'With today' in pg.inner_text('#cardioMeter')
        pg.click('[data-act=done][data-i="0"][data-j="0"]'); pg.wait_for_timeout(200)
        assert not pg.evaluate("!!document.getElementById('restBar') && !document.getElementById('restBar').hidden"), 'no rest timer after cardio'
        pg.click('#saveBtn'); pg.click('[data-act=confirm-save]'); pg.wait_for_selector('.result.ok')
        last = book(pg, 'Historical Data')[-1]
        assert last[2] == 'Other' and last[3] == 'cardio' and str(last[7]) == '30' and last[8] == '' and last[10] == '2.7 km, incline 8', last
        pg.click('[data-act=close]'); assert pg.evaluate('state.day') == nxt

@test
def insights_next_up_ignores_other(E):
    with E.page('?demo&pt') as pg:
        pg.wait_for_selector('.card'); nxt = pg.evaluate('nextPlanDay().day')
        pg.click('[data-act=other]'); pg.wait_for_selector('#ahCat'); pg.select_option('#ahEx', label='bike'); pg.click('[data-act=adhoc-add]')
        pg.fill('input[data-f=reps][data-i="0"][data-j="0"]', '20'); pg.click('#saveBtn'); pg.click('[data-act=confirm-save]'); pg.wait_for_selector('.result.ok'); pg.click('[data-act=close]')
        pg.click('[data-act=tab][data-tab=insights]'); pg.wait_for_selector('.nextup b', timeout=10000)
        assert pg.inner_text('.nextup b') == nxt, (pg.inner_text('.nextup b'), nxt)

# ------------------------------------------------------------------ PT
@test
def pt_unlock(E):
    with E.page(None, cont=False) as pg:
        pg.goto(E.base); pg.wait_for_selector('#ptCheck', timeout=20000)
        pg.check('#ptCheck'); pg.fill('#ptPw', 'wrong'); pg.click('[data-act=pt-unlock]'); pg.wait_for_timeout(1500)
        assert pg.evaluate("localStorage.getItem('wl:pt')") is None
        pg.fill('#ptPw', 'wPT_555'); pg.press('#ptPw', 'Enter'); pg.wait_for_timeout(2000)
        assert pg.evaluate("localStorage.getItem('wl:pt')") is not None
        pg.reload(); pg.wait_for_selector('.pt-box', timeout=20000)
        pg.click('[data-act=pt-exit]'); pg.wait_for_selector('#ptCheck', timeout=20000)
        assert pg.evaluate("localStorage.getItem('wl:pt')") is None

@test
def pt_insights(E):
    with E.page('?demo&pt') as pg:
        assert pg.inner_text('.tabs').replace('\n', ' ') == 'Log Diet Targets Insights Plan'
        pg.click('[data-act=tab][data-tab=insights]'); pg.wait_for_selector('#exCat'); pg.wait_for_selector('#chCardio svg', timeout=10000)
        assert pg.evaluate("document.querySelectorAll('#app svg').length") >= 4
        shot(pg, 'insights', full=True)

@test
def plan_editor_and_archive(E):
    rows = "__demoBook.tabs['Plan'].slice(3).filter(r => r && r[1]).map(r => r.slice(1, 9))"
    with E.page('?demo&pt') as pg:
        pg.click('[data-tab=plan]'); pg.click('[data-act=pl-edit]'); pg.wait_for_selector('#plCards')
        pg.click('[data-act=pl-day][data-i="1"]'); pg.fill('input[data-pf=sets][data-i="2"]', '4')
        pg.fill('#plCardio', '90')
        pg.click('[data-act=pl-review]'); pg.wait_for_selector('[data-act=pl-save]')
        assert 'Weekly cardio target' in pg.inner_text('#modalBody')
        pg.click('[data-act=pl-save]'); pg.wait_for_selector('.result.ok', timeout=10000); pg.click('.result [data-act=close]')
        assert pg.evaluate('state.model.cardioTarget') == 90
        assert any(r[0] == 'lower A' and str(r[3]) == '4' for r in pg.evaluate(rows))
        # create a new plan from empty, archiving the old one
        pg.click('[data-act=pl-new]'); pg.fill('#plNewName', 'Strength block Dec'); pg.click('input[value=empty]'); pg.click('[data-act=pl-create-go]'); pg.wait_for_selector('.days')
        pg.click('[data-act=pl-add]'); pg.select_option('#plCat', 'legs'); pg.select_option('#plEx', label='romanian deadlift'); pg.click('[data-act=pl-pick-ok]')
        pg.click('[data-act=pl-review]'); pg.click('[data-act=pl-save]'); pg.wait_for_selector('.result.ok', timeout=10000)
        arc = book(pg, 'Plan Archive'); assert len(arc) > 10 and arc[0][10] == 'Weekly Cardio (min)'
        assert pg.evaluate("__demoBook.tabs['Plan'][2][2]") == 'Strength block Dec'

@test
def plan_file_roundtrip(E):
    with E.page('?demo&pt', phone=False) as pg:
        pg.click('[data-tab=plan]')
        with pg.expect_download() as dl: pg.click('[data-act=pl-export]')
        path = os.path.join(OUT, dl.value.suggested_filename); dl.value.save_as(path)
        data = json.load(open(path)); assert data['kind'] == 'plan' and data['cardioMinPerWeek']
        pg.click('[data-act=pl-new]'); pg.wait_for_timeout(300); pg.click('input[value=file]', no_wait_after=True)
        pg.set_input_files('#plFile', path); pg.wait_for_timeout(300)
        pg.fill('#plNewName', 'Imported copy'); pg.click('[data-act=pl-create-go]'); pg.wait_for_selector('.days')
        pg.click('[data-act=pl-review]'); pg.click('[data-act=pl-save]'); pg.wait_for_selector('.result.ok')
        assert pg.evaluate('state.model.planName') == 'Imported copy'

@test
def pt_targets(E):
    with E.page('?demo&pt') as pg:
        pg.click('[data-act=tab][data-tab=targets]'); pg.wait_for_selector('#tgBar')
        nxt = pg.evaluate('TG.day'); i = pg.evaluate("TG.ex.findIndex(x => /press/.test(x.exercise))")
        for j, (r, w) in enumerate([('12', '40'), ('10', '42.5'), ('8', '45')]):
            pg.fill(f'[data-tf=reps][data-i="{i}"][data-j="{j}"]', r); pg.fill(f'[data-tf=wgt][data-i="{i}"][data-j="{j}"]', w)
        pg.click('#tgBar [data-act=tg-save]'); pg.wait_for_selector('.result.ok'); pg.click('[data-act=close]')
        pg.click('[data-act=tab][data-tab=log]'); pg.wait_for_selector('#cards')
        assert pg.evaluate('state.day') == nxt
        ci = pg.evaluate("state.entries.findIndex(e => targetFor(e))"); assert ci >= 0
        pg.click(f'[data-act=done][data-i="{ci}"][data-j="0"]')
        assert pg.evaluate(f"state.entries[{ci}].sets[0].wgt") == '40'
        pg.click('#saveBtn'); pg.click('[data-act=confirm-save]'); pg.wait_for_selector('.result.ok'); pg.wait_for_timeout(800)
        assert all(str(r[8]) for r in book(pg, 'PT Targets')[1:] if r and r[0]), 'targets marked used'
        assert any('PT target' in str(r[10]) for r in book(pg, 'Historical Data')[-6:])
        pg.click('[data-act=close]'); pg.click('[data-act=tab][data-tab=targets]'); pg.click(f'[data-act=tg-day][data-day="{nxt}"]')
        pg.wait_for_selector('[data-act=tg-reuse]'); pg.click('[data-act=tg-reuse]'); pg.click('[data-act=tg-plus]')
        assert pg.evaluate(f"TG.ex[{i}].sets[0].wgt") == '42.5'

# ------------------------------------------------------------------ diet
@test
def diet_trainee(E):
    with E.page('?demo') as pg:
        pg.click('[data-act=tab][data-tab=diet]'); pg.wait_for_selector('.d-nav')
        assert loaded(pg, 'diet.js') and not loaded(pg, 'dietpt.js')
        assert pg.evaluate('DT.open') == 'Breakfast'
        pg.click('[data-act=d-status][data-s=planned]'); pg.click('[data-act=d-save]'); pg.wait_for_timeout(700)
        if not pg.locator('.d-meal.open [data-meal="Lunch"]').count(): pg.click('[data-act=d-meal][data-meal="Lunch"]')
        pg.click('[data-act=d-status][data-s=adjusted]'); pg.fill('[data-df=amt][data-k="1"]', '250')
        assert 'over' in pg.inner_text('#dTot')
        pg.click('[data-act=d-swap][data-k="0"]'); pg.wait_for_selector('#dPickList')
        pg.click('[data-act=d-pick][data-food="tuna (in water)"]'); pg.click('[data-act=d-save]'); pg.wait_for_timeout(700)
        pg.click('[data-act=d-meal][data-meal="Dinner"]'); pg.click('[data-act=d-status][data-s=cheat]'); pg.fill('#dNotes', 'burger')
        pg.click('[data-act=d-save]'); pg.wait_for_timeout(700)
        pg.click('[data-act=d-sup][data-name="Creatine"]'); pg.wait_for_timeout(500)
        pg.click('[data-act=d-water][data-d="1"]'); pg.click('[data-act=d-water][data-d="1"]'); pg.wait_for_timeout(1800)
        today = pg.evaluate('isoDay(new Date())'); rows = [r for r in book(pg, 'Diet Log') if r and r[0] == today]
        st = {(r[1], r[2]) for r in rows}
        assert ('Breakfast', 'planned') in st and ('Lunch', 'adjusted') in st and ('Dinner', 'cheat') in st and ('Supplement', 'taken') in st, st
        assert any(r[1] == 'Water' and str(r[4]) == '2' for r in rows) and any(r[3] == 'tuna (in water)' for r in rows)
        shot(pg, 'diet_today', full=True)
        pg.click('[data-act=d-day][data-d="-1"]'); assert pg.inner_text('.d-nav b') == 'Yesterday'

@test
def diet_pt_planner_and_new_plan(E):
    with E.page('?demo&pt') as pg:
        pg.click('[data-act=tab][data-tab=plan]'); pg.click('[data-act=dp-view][data-v=diet]'); pg.wait_for_selector('#dpName')
        pg.fill('[data-dpf=meal-val][data-m=c][data-i="0"]', '55')
        pg.click('[data-act=dp-it-add][data-i="0"]'); pg.click('[data-act=dp-pick][data-v="banana"]')
        pg.click('#dpBar [data-act=dp-save]'); pg.wait_for_selector('.result.ok', timeout=8000); pg.click('[data-act=close]')
        assert [r for r in book(pg, 'Diet Plan') if r[0] == 'Meal'][0][7] == 'max 55'
        n = len([r for r in book(pg, 'Diet Log')[1:] if any(c != '' for c in r)]); assert n > 20
        pg.click('[data-act=dp-newask]'); pg.click('[data-act=dp-new-copy]'); pg.fill('#dpName', 'Cut – Dec')
        pg.click('#dpBar [data-act=dp-save]'); pg.wait_for_selector('[data-act=dp-save-go]', timeout=8000)
        assert 'deletes all' in pg.inner_text('.modal')
        pg.click('[data-act=dp-save-go]'); pg.wait_for_selector('.result.ok', timeout=8000)
        assert not [r for r in book(pg, 'Diet Log')[1:] if any(c != '' for c in r)]
        assert book(pg, 'Diet Plan')[1][2] == 'Cut – Dec'

@test
def diet_insights(E):
    with E.page('?demo&pt') as pg:
        pg.click('[data-act=tab][data-tab=insights]'); pg.wait_for_selector('[data-act=di-view]', timeout=10000)
        pg.click('[data-act=di-view][data-v=diet]'); pg.wait_for_selector('#chDietK svg', timeout=10000)
        assert 'Meals on target' in pg.inner_text('#app'); shot(pg, 'diet_insights', full=True)

@test
def foods_files(E):
    with E.page('?demo&pt') as pg:
        pg.click('[data-act=tab][data-tab=plan]'); pg.click('[data-act=dp-view][data-v=foods]'); pg.wait_for_selector('[data-act=df-export]')
        with pg.expect_download() as dl: pg.click('[data-act=df-export]')
        data = json.load(open(dl.value.path())); assert data['kind'] == 'foods' and len(data['foods']) >= 20
        f2 = dict(app='workout-log', kind='foods', version=1, foods=[dict(data['foods'][1], kcal=999), {'name': 'Labneh', 'group': 'dairy', 'kcal': 180, 'p': 6, 'c': 4, 'f': 16}])
        p2 = os.path.join(OUT, 'f2.json'); json.dump(f2, open(p2, 'w'))
        pg.set_input_files('#dfFile', p2); pg.click('[data-act=df-import-go]'); pg.wait_for_timeout(800)
        foods = book(pg, 'Foods'); egg = [r for r in foods if r[0] == data['foods'][1]['name']][0]
        assert foods[-1][0] == 'Labneh' and egg[2] != 999, 'existing foods are skipped'
        # a diet file overrides food values
        pg.click('[data-act=dp-view][data-v=diet]'); pg.wait_for_selector('#dpName')
        with pg.expect_download() as dl: pg.click('[data-act=dp-export]')
        dd = json.load(open(dl.value.path()))
        for f in dd['foods']:
            if f['name'] == 'egg': f['kcal'] = 155
        p3 = os.path.join(OUT, 'd2.json'); json.dump(dd, open(p3, 'w'), ensure_ascii=False)
        pg.set_input_files('#dpFile', p3); pg.wait_for_selector('[data-act=dp-import-go]'); pg.click('[data-act=dp-import-go]'); pg.wait_for_timeout(800)
        assert [r for r in book(pg, 'Foods') if r[0] == 'egg'][0][2] == 155 and pg.evaluate('DPT.draft.mode') == 'new'

@test
def all_tabs_smoke(E):
    with E.page('?demo&pt') as pg:
        for t in ['insights', 'plan', 'targets', 'diet', 'log', 'insights', 'log']:
            pg.click(f'[data-act=tab][data-tab={t}]'); pg.wait_for_timeout(900)
        pg.set_viewport_size({'width': 360, 'height': 780}); pg.wait_for_timeout(200)

# ------------------------------------------------------------------ caching
@test
def version_stamp_current(E):
    r = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'stamp.py'), '--check'], capture_output=True, text=True)
    assert r.returncode == 0, 'index.html version is stale: run python3 tools/stamp.py'

@test
def works_offline_after_first_visit(E):
    with E.page('?demo') as pg:
        pg.evaluate("navigator.serviceWorker.ready.then(() => 0)"); pg.reload(); pg.wait_for_selector('.checks')
        assert pg.evaluate("!!navigator.serviceWorker.controller"), 'service worker controls the page'
        pg.click('[data-act=continue]'); pg.click('[data-act=tab][data-tab=diet]'); pg.wait_for_selector('.d-nav')
        cached = pg.evaluate("caches.open('workout-log-v1').then(c => c.keys()).then(k => k.map(r => new URL(r.url).pathname + new URL(r.url).search))")
        assert any(c.startswith('/progress.js?v=') for c in cached) and any(c.startswith('/diet.js?v=') for c in cached), cached
        pg.context.set_offline(True)
        pg.reload(); pg.wait_for_selector('.checks', timeout=10000); pg.click('[data-act=continue]'); pg.wait_for_selector('.card')
        pg.click('[data-act=tab][data-tab=diet]'); pg.wait_for_selector('.d-nav')
        pg.context.set_offline(False)

# ------------------------------------------------------------------ runner
def main():
    want = sys.argv[1:]
    port = free_port()
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    failed = []
    try:
        with sync_playwright() as pw:
            E = Env(pw, f'http://127.0.0.1:{port}/')
            for t in TESTS:
                if want and not any(w in t.__name__ for w in want): continue
                t0 = time.time()
                try: t(E); print(f'  ✓ {t.__name__} ({time.time() - t0:.1f}s)')
                except Exception as e:
                    failed.append(t.__name__); print(f'  ✗ {t.__name__}: {e}'); traceback.print_exc(limit=2)
    finally: srv.terminate()
    print(f"\n{'FAILED: ' + ', '.join(failed) if failed else 'All tests passed.'}")
    sys.exit(1 if failed else 0)

if __name__ == '__main__': main()
