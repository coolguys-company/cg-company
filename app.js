const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const msg = document.currentScript.dataset;

// Demo: three scenes, each its own picture of "scattered in, ordered out", played in turn on a loop.
// A thin bar in the active tab counts down to the next scene. Choosing a tab stops the loop and
// leaves that scene on screen; keyboard focus holds a finished result; off-screen it stops. Without GSAP or with reduced motion every scene shows finished and still.
const demo = document.querySelector('[data-demo]');
if (demo) {
  const tabs = [...demo.querySelectorAll('[role="tab"]')];
  const scenes = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')));
  const bars = tabs.map((t) => t.querySelector('.tab__bar'));
  const animate = !still && !!window.gsap;
  let extras = []; // tweens and nodes a scene makes outside its timeline

  const cleanup = () => {
    extras.forEach((x) => (x.kill ? x.kill() : x.remove()));
    extras = [];
  };
  const rel = (el, f) => { const r = el.getBoundingClientRect(); return { x: r.left - f.left, y: r.top - f.top, w: r.width, h: r.height }; };

  // 1. Tree: tilted cards fade in, a wire draws from each to its leaf, the card rides the wire while
  // the wire shortens behind it, and lands as a leaf; the post is then sent.
  const playTree = (scene) => {
    const chips = [...scene.querySelectorAll('.chip')];
    const leaves = [...scene.querySelectorAll('.tree__leaf')];
    const branches = [...scene.querySelectorAll('.tree__branch')];
    const post = scene.querySelector('.post'), sent = scene.querySelector('.post__sent');
    const wires = scene.querySelector('.wires');
    gsap.set([...chips, ...leaves, ...branches, sent, ...chips.map((c) => c.firstElementChild)], { clearProps: 'transform,opacity' });
    post.classList.remove('is-sent');
    wires.replaceChildren();
    const f = scene.getBoundingClientRect();
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.set([...branches, ...leaves, sent], { opacity: 0 }, 0)
      .fromTo(chips, { opacity: 0, scale: 0.92, rotation: (i, el) => +el.dataset.r }, { opacity: 1, scale: 1, duration: 0.45, stagger: { each: 0.03, from: 'random' } }, 0);
    const drift = chips.map((chip) => gsap.to(chip.firstElementChild, {
      y: gsap.utils.random(-5, 5), rotation: gsap.utils.random(-1.2, 1.2),
      duration: gsap.utils.random(1.6, 2.4), ease: 'sine.inOut', yoyo: true, repeat: 3,
    }));
    extras.push(...drift);
    const seen = new Set();
    chips.forEach((chip, i) => {
      const leaf = leaves.find((l) => l.dataset.id === chip.dataset.id);
      const branch = leaf.closest('.tree__branch');
      const c = rel(chip, f), l = rel(leaf, f);
      const side = l.x > c.x + c.w; // desktop: tree to the right; phone: cards lie over the tree
      const a0 = side ? { x: c.w, y: c.h / 2 } : { x: 0, y: c.h / 2 };
      const x1 = c.x + a0.x, y1 = c.y + a0.y, x2 = l.x, y2 = l.y + l.h / 2;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', side
        ? `M${x1},${y1} C${x1 + (x2 - x1) * 0.55},${y1} ${x2 - (x2 - x1) * 0.45},${y2} ${x2},${y2}`
        : `M${x1},${y1} C${x1 - 40},${y1} ${x2 - 40},${y2} ${x2},${y2}`);
      path.setAttribute('pathLength', '1');
      path.style.strokeDasharray = '0 2';
      wires.append(path);
      const len = path.getTotalLength(), r = +chip.dataset.r;
      const st = { q: 0, p: 0 }; // the wire shows from p (eaten by the card) to q (drawn so far)
      const draw = () => { path.style.strokeDasharray = `${Math.max(st.q - st.p, 0)} 2`; path.style.strokeDashoffset = String(-st.p); };
      const ride = () => {
        draw();
        const pt = path.getPointAtLength(st.p * len);
        const ax = a0.x * (1 - st.p), ay = a0.y + (c.h / 2 - a0.y) * st.p;
        gsap.set(chip, { x: pt.x - ax - c.x, y: pt.y - ay - c.y, rotation: r * (1 - st.p), scale: 1 - 0.08 * st.p });
      };
      const t = 0.55 + i * 0.2;
      tl.to(st, { q: 1, duration: 0.3, ease: 'power1.inOut', onUpdate: draw }, t)
        .call(() => { drift[i].kill(); gsap.to(chip.firstElementChild, { y: 0, rotation: 0, duration: 0.25 }); }, null, t + 0.15)
        .to(st, { p: 1, duration: 0.6, ease: 'power2.inOut', onUpdate: ride }, t + 0.2)
        .to(chip, { opacity: 0, duration: 0.12, ease: 'power1.in' }, t + 0.76)
        .fromTo(leaf, { opacity: 0, x: -6 }, { opacity: 1, x: 0, duration: 0.25 }, t + 0.74)
        .call(() => leaf.classList.add('is-fresh'), null, t + 0.74)
        .call(() => leaf.classList.remove('is-fresh'), null, t + 1.4);
      if (!seen.has(branch)) {
        seen.add(branch);
        tl.fromTo(branch, { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: 0.35 }, t + 0.5);
      }
    });
    const end = 0.55 + chips.length * 0.2 + 0.8;
    tl.call(() => post.classList.add('is-sent'), null, end)
      .fromTo(sent, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.45 }, end)
      .call(() => post.classList.remove('is-sent'), null, end + 1.2);
    return tl;
  };

  // 2. Board: requests drop one by one into an inbox queue, fly onto the "new" column, which grows
  // to hold all six, then move to the columns they belong in while "new" shrinks back to two. The
  // moving cards are copies laid over the board (the real ones stay put, hidden) so nothing in the
  // layout reflows; the "new" column's background grows by clip-path, and on phones the columns under
  // it slide down out of the way.
  const playBoard = (scene) => {
    const cards = [...scene.querySelectorAll('.card')].sort((a, b) => a.dataset.k - b.dataset.k);
    const stream = scene.querySelector('.stream');
    const colEls = [...scene.querySelectorAll('.board__col')];
    const cols = Object.fromEntries(colEls.map((c) => [c.dataset.col, c]));
    const counts = Object.fromEntries(colEls.map((c) => [c.dataset.col, c.querySelector('[data-count]')]));
    const inbox = scene.querySelector('[data-inbox]');
    gsap.set([...cards, ...colEls], { clearProps: 'transform,opacity' });
    colEls.forEach((c) => c.classList.remove('is-lit'));
    const f = scene.getBoundingClientRect();
    const home = cards.map((c) => rel(c, f)); // where each card ends, in its own column
    const s = rel(stream, f), label = stream.querySelector('.zone-label');
    const top0 = s.y + (label.offsetParent ? label.offsetTop + label.offsetHeight + 16 : 0); // queue starts under the label
    const left0 = s.x + parseFloat(getComputedStyle(stream).paddingLeft);
    const colNew = cols.new, cN = rel(colNew, f), n = rel(colNew.querySelector('ul'), f);
    const step = home[0].h + 8;
    const padB = parseFloat(getComputedStyle(colNew).paddingBottom);
    const fit = (count) => Math.max(cN.h, n.y - cN.y + count * step - 8 + padB);
    const fullH = fit(cards.length);
    let bg = colNew.querySelector('.board__bg');
    if (!bg) {
      bg = document.createElement('span');
      bg.className = 'board__bg';
      bg.setAttribute('aria-hidden', 'true');
      colNew.prepend(bg);
      colNew.classList.add('has-bg');
    }
    bg.style.height = `${fullH}px`;
    const clip = (h) => `inset(0px 0px ${fullH - h}px 0px round 8px)`;
    const below = colEls.filter((c) => c !== colNew && rel(c, f).y > cN.y + 4); // stacked under "new" on phones
    const ghosts = cards.map((card, k) => {
      const g = card.cloneNode(true);
      g.classList.add('card--ghost');
      g.style.width = `${home[k].w}px`;
      g.style.zIndex = 30 + k;
      scene.append(g);
      extras.push(g);
      return g;
    });
    const ghostChecks = ghosts.flatMap((g) => [...g.querySelectorAll('.check')]);
    const tally = { new: 0, work: 0, done: 0, inbox: 0 };
    const show = () => Object.keys(tally).forEach((k) => { (k === 'inbox' ? inbox : counts[k]).textContent = tally[k]; });
    const tl = gsap.timeline({ defaults: { ease: 'power3.inOut' } });
    tl.call(() => { Object.keys(tally).forEach((k) => { tally[k] = 0; }); show(); }, null, 0)
      .set(cards, { opacity: 0 }, 0)
      .set(bg, { clipPath: clip(cN.h) }, 0)
      .set(ghostChecks, { opacity: 0, scale: 0.4 }, 0);
    const grow = (k, at) => {
      const h = fit(k + 1);
      if (h <= cN.h) return;
      tl.to(bg, { clipPath: clip(h), duration: 0.4, ease: 'power2.out' }, at);
      below.forEach((c) => tl.to(c, { y: h - cN.h, duration: 0.4, ease: 'power2.out' }, at));
    };
    let t2;
    if (getComputedStyle(stream).display === 'none') {
      // phones have no room for a queue: each request pops out of its channel in the strip above
      // the board, the channel counts it, and it flies into "new", which grows with each
      const sources = Object.fromEntries([...scene.querySelectorAll('.source')].map((el) => [el.dataset.src, el]));
      const sent = Object.fromEntries(Object.keys(sources).map((key) => [key, 0]));
      const showSent = () => Object.entries(sources).forEach(([key, el]) => { el.querySelector('[data-src-count]').textContent = sent[key]; });
      tl.call(() => { Object.keys(sent).forEach((key) => { sent[key] = 0; }); showSent(); Object.values(sources).forEach((el) => el.classList.remove('is-lit')); }, null, 0);
      ghosts.forEach((g, k) => {
        const key = cards[k].dataset.src, src = sources[key], p = rel(src, f);
        const at = 0.2 + k * 0.42;
        tl.call(() => { sent[key] += 1; showSent(); src.classList.add('is-lit'); }, null, at)
          .call(() => src.classList.remove('is-lit'), null, at + 0.5)
          .fromTo(g, { x: p.x + p.w / 2 - home[k].w / 2, y: p.y, opacity: 0, scale: 0.6 },
            { opacity: 1, scale: 0.9, duration: 0.25, ease: 'power2.out' }, at)
          .to(g, { x: n.x, y: n.y + k * step, scale: 1, duration: 0.55 }, at + 0.25)
          .call(() => { tally.new += 1; show(); }, null, at + 0.75);
        grow(k, at + 0.35);
      });
      t2 = 0.2 + cards.length * 0.42 + 0.8;
    } else {
      ghosts.forEach((g, k) => {
        tl.fromTo(g, { x: left0, y: top0 + k * step - 28, opacity: 0, rotation: k % 2 ? 1.5 : -1.5 },
          { y: top0 + k * step, opacity: 1, duration: 0.4, ease: 'back.out(1.6)' }, 0.1 + k * 0.2)
          .call(() => { tally.inbox += 1; show(); }, null, 0.3 + k * 0.2);
      });
      const t1 = 0.1 + cards.length * 0.2 + 0.35;
      ghosts.forEach((g, k) => {
        const at = t1 + k * 0.16;
        grow(k, at + 0.15);
        tl.to(g, { x: n.x, y: n.y + k * step, rotation: 0, duration: 0.55 }, at)
          .call(() => { tally.inbox -= 1; show(); }, null, at + 0.1)
          .call(() => { tally.new += 1; show(); }, null, at + 0.45);
      });
      t2 = t1 + cards.length * 0.16 + 0.8;
    }
    tl.to(bg, { clipPath: clip(cN.h), duration: 0.6 }, t2 + 0.25);
    below.forEach((c) => tl.to(c, { y: 0, duration: 0.6 }, t2 + 0.25));
    let j = 0;
    ghosts.forEach((g, k) => {
      const col = cards[k].dataset.col;
      const at = col === 'new' ? t2 + 0.45 : t2 + 0.14 * j++;
      tl.to(g, { x: home[k].x, y: home[k].y, duration: 0.6 }, at);
      if (col !== 'new') tl.call(() => { tally.new -= 1; tally[col] += 1; show(); }, null, at + 0.45);
    });
    const t3 = t2 + 1.2;
    tl.to(ghostChecks, { opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(2)', stagger: 0.1 }, t3)
      .call(() => cols.done.classList.add('is-lit'), null, t3)
      .call(() => { gsap.set(cards, { opacity: 1 }); ghosts.forEach((g) => g.remove()); }, null, t3 + 0.5)
      .call(() => cols.done.classList.remove('is-lit'), null, t3 + 1.1);
    return tl;
  };

  // 3. Prices: a beam scans four pages in four formats; each price lights up, is cut out and flies
  // onto one scale; then your price line drops in and the cheapest rival is called out.
  const playPrices = (scene) => {
    const scan = scene.querySelector('.scan');
    const rows = [...scene.querySelectorAll('.scan__row')];
    const beam = scene.querySelector('.scan__beam');
    const dots = [...scene.querySelectorAll('.dots__dot')];
    const vals = [...scene.querySelectorAll('.dots__val')];
    const low = scene.querySelector('.dots__dot.is-low');
    const lowTag = scene.querySelector('.dots__low');
    const mine = scene.querySelector('.dots__mine'), mineLabel = scene.querySelector('.dots__mine-label');
    const verdict = scene.querySelector('.dots__verdict');
    gsap.set([...dots, ...vals, beam, mine, mineLabel, verdict, lowTag], { clearProps: 'transform,opacity' });
    rows.forEach((r) => r.classList.remove('is-hit'));
    low.classList.remove('is-low');
    const f = scene.getBoundingClientRect();
    const sc = rel(scan, f);
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.set([...dots, ...vals, mineLabel, verdict, lowTag], { opacity: 0 }, 0)
      .set(mine, { scaleY: 0 }, 0)
      .fromTo(beam, { y: 0, opacity: 0 }, { opacity: 1, duration: 0.2 }, 0.2)
      .to(beam, { y: sc.h, duration: 2.2, ease: 'none' }, 0.2)
      .to(beam, { opacity: 0, duration: 0.2 }, 2.3);
    rows.forEach((row, i) => {
      const r = rel(row, f), val = row.querySelector('.scan__val');
      const t = 0.2 + 2.2 * ((r.y - sc.y + r.h / 2) / sc.h);
      const v = rel(val, f), d = rel(dots[i], f);
      tl.call(() => row.classList.add('is-hit'), null, t)
        .call(() => {
          const fly = document.createElement('span');
          fly.className = 'fly';
          fly.textContent = val.textContent;
          scene.append(fly);
          extras.push(fly);
          gsap.fromTo(fly, { x: v.x, y: v.y, opacity: 1 }, {
            keyframes: [
              { x: (v.x + d.x) / 2, y: Math.min(v.y, d.y) - 40, duration: 0.35, ease: 'power1.out' },
              { x: d.x, y: d.y, scale: 0.6, duration: 0.35, ease: 'power2.in' },
              { opacity: 0, duration: 0.12 },
            ],
            onComplete: () => fly.remove(),
          });
        }, null, t + 0.1)
        .fromTo(dots[i], { opacity: 0, scale: 0 }, { opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(2.4)' }, t + 0.8)
        .to(vals[i], { opacity: 1, duration: 0.3 }, t + 0.9);
    });
    tl.to(mine, { scaleY: 1, duration: 0.5, ease: 'power2.inOut' }, 2.9)
      .to(mineLabel, { opacity: 1, duration: 0.3 }, 3.1)
      .call(() => low.classList.add('is-low'), null, 3.5)
      .fromTo(low, { scale: 1 }, { scale: 1.5, duration: 0.18, yoyo: true, repeat: 1, ease: 'power1.inOut' }, 3.5)
      .to(lowTag, { opacity: 1, duration: 0.3 }, 3.6)
      .fromTo(verdict, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.45 }, 3.9);
    return tl;
  };

  const PLAY = { tree: playTree, board: playBoard, prices: playPrices };
  const HOLD = { tree: 1.6, board: 2.2, prices: 2.8 }; // seconds each finished result stays before the next scene
  const st = { seen: false, focus: false, manual: false, started: false };
  let current = 0, master = null, sceneEnd = 0;

  const sync = () => {
    if (!master) return;
    const holding = st.focus && master.time() >= sceneEnd;
    if (!st.seen || holding) master.pause(); else master.resume();
  };

  const run = (i) => {
    master?.kill();
    cleanup();
    current = i;
    tabs.forEach((t, k) => {
      t.setAttribute('aria-selected', String(k === i));
      t.tabIndex = k === i ? 0 : -1;
      scenes[k].hidden = k !== i;
    });
    gsap.set(bars, { scaleX: 0 });
    gsap.fromTo(scenes[i], { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power1.out' });
    const kind = scenes[i].dataset.kind;
    const tl = PLAY[kind](scenes[i]);
    sceneEnd = tl.duration();
    master = gsap.timeline({ onComplete: () => { if (!st.manual) run((i + 1) % scenes.length); } });
    master.add(tl, 0).call(sync, null, sceneEnd);
    if (!st.manual) master.to(bars[i], { scaleX: 1, duration: sceneEnd + HOLD[kind], ease: 'none' }, 0);
    sync();
  };

  const select = (i) => {
    tabs.forEach((t, k) => {
      t.setAttribute('aria-selected', String(k === i));
      t.tabIndex = k === i ? 0 : -1;
      scenes[k].hidden = k !== i;
    });
    current = i;
  };

  scenes.forEach((sc, k) => { sc.hidden = k !== 0; });
  if (!animate) {
    demo.classList.add('is-static');
    scenes.forEach((sc) => sc.classList.add('is-static'));
  } else {
    gsap.config({ force3D: true });
    gsap.set(demo.querySelectorAll('.chip, .tree__branch, .tree__leaf, .post__sent, .card, .dots__dot, .dots__val, .dots__mine-label, .dots__verdict'), { opacity: 0 });
  }
  // a chosen tab means the visitor took over: play that scene once and stop the loop
  const choose = (i) => { st.manual = true; animate ? run(i) : select(i); };
  tabs.forEach((t, i) => t.addEventListener('click', () => choose(i)));
  demo.querySelector('[role="tablist"]').addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    const i = (current + step + tabs.length) % tabs.length;
    choose(i);
    tabs[i].focus();
  });
  if (animate) {
    const stage = demo.querySelector('.scenes');
    // keyboard focus holds the finished result; a mouse click on a tab does not
    stage.addEventListener('focusin', (e) => { st.focus = e.target.matches(':focus-visible'); sync(); });
    stage.addEventListener('focusout', () => { st.focus = false; sync(); });
    new IntersectionObserver(([e]) => {
      st.seen = e.isIntersecting;
      if (st.seen && !st.started) { st.started = true; document.fonts.ready.then(() => run(0)); }
      sync();
    }, { threshold: 0.3 }).observe(stage);
  }
}

// Brief form: validates, and says plainly that nothing is sent until an endpoint is set.
document.querySelectorAll('form[data-endpoint]').forEach((form) => {
  const help = form.querySelector('[aria-live]');
  const fields = [[form.elements.task, msg.msgTask], [form.elements.reach, msg.msgReach]];
  fields.forEach(([el]) => el.addEventListener('input', () => el.removeAttribute('aria-invalid')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const bad = fields.find(([el]) => !el.value.trim());
    fields.forEach(([el]) => el.toggleAttribute('aria-invalid', !el.value.trim()));
    if (bad) { bad[0].setAttribute('aria-describedby', help.id); help.textContent = bad[1]; bad[0].focus(); return; }
    if (!form.dataset.endpoint) { help.textContent = msg.msgOffline; return; }
    const btn = form.querySelector('[type="submit"]');
    btn.setAttribute('aria-busy', 'true');
    fetch(form.dataset.endpoint, { method: 'POST', body: new FormData(form) })
      .then((r) => { help.textContent = r.ok ? msg.msgOk : msg.msgFail; if (r.ok) form.reset(); })
      .catch(() => { help.textContent = msg.msgFail; })
      .finally(() => btn.removeAttribute('aria-busy'));
  });
});
