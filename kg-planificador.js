(function () {
  // ======================= AJUSTES =======================
  var A = {
    FARMERS_MIN: 4,        // farmers fijos mínimos (sube solo si falta catnip)
    REPLANEAR_SEG: 30,     // cada cuántos segundos revisa el reparto mientras ejecuta
    HORAS_MAX: 168,        // límite de la simulación (7 días; avanza por saltos, así que no tarda)
    RESERVA_CAZA: 1000,    // catpower que siempre se deja
    CULTURA_PCT: 0.90,     // manuscripts automáticos al llegar a este % de culture
    STEEL_CADA_SEG: 60,
    MAX_EDIFICIOS_AYUDA: 10, // cuántos edificios "que adelantan la meta" puede sugerir (pueden repetirse: varios Oil Wells)
    RESERVA_FURS: 1000,    // furs que siempre se dejan (los gatitos los consumen y dan felicidad)
    MAX_BARCOS: 243,       // con 243 barcos el titanium sale en el 100 % de los tratos
    OPORTUNIDAD_PCT: 0.95, // compras de oportunidad: solo con recursos llenos a este %
    ESCASOS: ["gold", "titanium"], // se siguen produciendo aunque la meta no los necesite
    ESCASOS_MAX_PCT: 0.4,  // como mucho este % de los gatitos libres se dedica a mantener los edificios que consumen
    COLCHON_SEG: 120,      // insumos que se guardan para los edificios que consumen: este tiempo de consumo
    MANT_MARGEN: 1.15,     // margen al calcular los gatitos de mantenimiento (los que quedan rinden menos que el promedio)
    SOSTENER_MAX: 10,      // como mucho tantos edificios por recurso para que no se acabe (p. ej. Oil Wells)
    ORO_TRATOS_PCT: 0.95,  // con el gold a este % del tope, el sobrante se cambia por titanium
    ORO_DEJAR_PCT: 0.8,    // …y se deja este % del tope de gold guardado
    EDIFICIOS_HORAS: 6,    // modo edificios: solo considera los que se alcanzan en este tiempo
    EDIFICIOS_EXCLUIR: ["unicornPasture"] // la Unicorn Pasture la decide "Invertir unicorns"
  };
  // ======================================================
  function tps() { return game.getTicksPerSecondUI ? game.getTicksPerSecondUI() : (game.ticksPerSecond || 5); } // velocidad real (con aceleración)
  var VIEJOS = [window.__kgAuto, window.__kgReparto, window.__kgPlan];
  VIEJOS.forEach(function (v) { if (!v) return; if (v.timer) clearInterval(v.timer); if (v.caja) v.caja.remove(); });

  var CLAVE = "kgPlanificador";
  var d = (window.__kgPlan && window.__kgPlan.d) || null, retomar = null;
  if (!d) { // al recargar la página: recupera opciones, bitácora y el plan que iba
    d = {};
    try { var g = JSON.parse(localStorage.getItem(CLAVE) || "{}"); d.on = g.on; d.log = g.log; d.tot = g.tot; d.totDesde = g.totDesde; d.modoEdificios = g.modoEdificios; d.historial = g.historial; if (g.meta && g.ejecutando) retomar = g; } catch (e) {}
  }
  d.on = Object.assign({ cielo: true, refinar: true, cazar: true, manuscript: true, steel: true, bsp: true, fe: true, unicornios: true,
    festival: true, oportunidad: true, escasos: true, oroTitanio: true, edificios: true }, d.on || {}); // las opciones nuevas vienen encendidas
  d.log = d.log || [];
  d.historial = d.historial || []; // metas cumplidas: tiempo estimado y real
  d.tot = d.tot || {};          // resumen: totales desde que pegaste el script
  d.totDesde = d.totDesde || Date.now();
  d.plan = d.plan || null;      // plan calculado
  d.ejecutando = !!d.ejecutando;
  d.pausa = !!d.pausa;
  var segundos = 0, ultimoReparto = -999, ultimoUnicornio = -999, infoUnicornio = "", calculando = false, abiertos = {}, ultimaBusqueda = -999, ultimaReestimacion = 0, ultimaEtapa = null;
  function guardar() {
    try {
      localStorage.setItem(CLAVE, JSON.stringify({ on: d.on, log: d.log.slice(0, 40), tot: d.tot, totDesde: d.totDesde,
        meta: d.plan ? { type: d.plan.type, name: d.plan.name, auto: !!d.plan.auto, inicio: d.plan.inicio, estimado: d.plan.estimado, pausado: d.plan.pausado, pausaDesde: d.plan.pausaDesde, hechos: (d.plan.hechos || []).slice(-10) } : null,
        ejecutando: d.ejecutando, pausa: d.pausa, modoEdificios: !!d.modoEdificios, historial: d.historial.slice(0, 10) }));
    } catch (e) {}
  }
  function esperar() { return new Promise(function (r) { setTimeout(r, 0); }); } // deja respirar al juego

  // ----------------------- utilidades -----------------------
  function R(n) { return game.resPool.get(n); }
  function titulo(n) { var r = R(n); return (r && r.title) || n; }
  function num(x) { var a = Math.abs(x); return a >= 1e6 ? (x / 1e6).toFixed(2) + "M" : a >= 1e3 ? (x / 1e3).toFixed(1) + "K" : (Math.round(x * 10) / 10).toString(); }
  function tiempo(s) {
    if (!isFinite(s)) return "nunca (más de " + textoLimite() + ")";
    if (s < 1.5) return "ya";
    if (s < 60) return Math.round(s) + " s";
    if (s < 3600) return Math.round(s / 60) + " min";
    return Math.floor(s / 3600) + " h " + Math.round((s % 3600) / 60) + " min";
  }
  function textoLimite() { return A.HORAS_MAX >= 48 ? Math.round(A.HORAS_MAX / 24) + " días" : A.HORAS_MAX + " h"; }
  function hora(ts) { var t = ts ? new Date(ts) : new Date(); return ("0" + t.getHours()).slice(-2) + ":" + ("0" + t.getMinutes()).slice(-2); }
  function anotar(txt) { d.log.unshift(hora() + " " + txt); d.log.length = Math.min(d.log.length, 40); }
  function sumar(clave, n) { if (n > 0) d.tot[clave] = (d.tot[clave] || 0) + n; } // para el resumen
  // fabrica y anota en el resumen cuánto salió de verdad
  function craftear(nombre, veces) {
    if (!(veces >= 1)) return 0;
    var antes = R(nombre).value;
    if (game.workshop.craft(nombre, veces, true) === false) return 0;
    sumar(nombre, R(nombre).value - antes);
    return veces;
  }
  var JT = {}; game.village.jobs.forEach(function (j) { JT[j.name] = j.title; });

  // ---------- comprar cualquier cosa por la misma vía que la cola del juego ----------
  function cm(type, name) { try { return game.time.queue.getQueueElementControllerAndModel({ name: name, type: type }); } catch (e) { return null; } }
  function precios(type, name) {
    if (type === "buildings") return game.bld.getPrices(name);
    var c = cm(type, name); return c && c.model ? (c.model.prices || []) : [];
  }
  function comprar(type, name) {
    var c = cm(type, name); if (!c || !c.controller || !c.model) return false;
    try { if (c.controller.updateEnabled) c.controller.updateEnabled(c.model); } catch (e) {}
    var r = c.controller.buyItem(c.model, { boughtByQueue: true });
    if (r && r.itemBought) { sumar("compras", 1); game.render && game.render(); return true; }
    return false;
  }
  function etiqueta(type, name) {
    try {
      if (type === "buildings") return game.bld.getBuildingExt(name).get("label") || name;
      if (type === "tech") return game.science.get(name).label;
      if (type === "upgrades") return game.workshop.get(name).label;
    } catch (e) {}
    return name;
  }

  // ---------- recetas ----------
  var RECETAS = {};
  function rec(n) {
    if (n in RECETAS) return RECETAS[n];
    var o = null;
    try {
      var c = game.workshop.getCraft(n);
      if (c && c.unlocked) {
        o = { porVez: {}, rinde: 1 + (game.getResCraftRatio(n) || 0) };
        game.workshop.getCraftPrice(c).forEach(function (x) { o.porVez[x.name] = x.val; });
      }
    } catch (e) {}
    return (RECETAS[n] = o);
  }
  function esFab(n) { return n !== "wood" && !!rec(n); }
  function insumo(n) { var r = rec(n), o = {}; Object.keys(r.porVez).forEach(function (q) { o[q] = r.porVez[q] / r.rinde; }); return o; } // por unidad

  // ---------- caza (fórmula del juego) ----------
  function caza() {
    var h = (game.getEffect("hunterRatio") || 0) + (game.village.getEffectLeader ? game.village.getEffectLeader("manager", 0) : 0);
    return {
      costo: Math.max(1, 100 - (game.getEffect("huntCatpowerDiscount") || 0)),
      furs: 40 + 32.5 * h,
      ivory: (0.45 + 0.02 * h) * (25 + 20 * h),
      bono: h
    };
  }

  // ---------- comercio con las Zebras (fórmula del juego) ----------
  function zebras(extraBarcos) {
    var dip = game.diplomacy, z = dip.get("zebras");
    if (!z || !z.unlocked) return null;
    var barcos = R("ship").value + (extraBarcos || 0), vol = dip.getTradeVolume ? dip.getTradeVolume() : 1;
    var exito = Math.max(0, Math.min(1, 1 + dip.getFinalStanding(z)));
    var prob = Math.min(1, 0.15 + barcos * 0.0035);
    var rel = game.getEffect("zebraRelationModifier") * (game.bld.getBuildingExt("tradepost").meta.effects["tradeRatio"] || 0);
    var cant = (1.5 + barcos * 0.03) * (1 + rel) * vol;
    return { race: z, exito: exito, prob: prob, porTi: cant, ti: exito * prob * cant,
      catpower: dip.getManpowerCost(), gold: dip.getGoldCost(), compra: z.buys[0].name, compraVal: z.buys[0].val * vol };
  }
  // pasos de comercio para conseguir cierta cantidad de titanium
  function pasosComercio(faltaTi, extraBarcos) {
    var z = zebras(extraBarcos); if (!z || z.ti <= 0 || faltaTi <= 0) return [];
    var cz = caza(), n = Math.ceil(faltaTi / z.ti), goldTope = R("gold").maxValue || Infinity;
    var porTanda = Math.max(1, Math.min(n, Math.floor(goldTope / z.gold), 50)), pasos = [];
    for (var hechos = 0; hechos < n; hechos += porTanda) {
      var k = Math.min(porTanda, n - hechos);
      pasos.push({ type: "trade", name: "zebras", k: k, motivo: "titanium", gana: { titanium: z.ti * k },
        reales: [{ name: "gold", val: z.gold * k }, { name: z.compra, val: z.compraVal * k }],
        // el catpower de los tratos se cuenta como furs que se dejan de cazar
        p: [{ name: "gold", val: z.gold * k }, { name: z.compra, val: z.compraVal * k }, { name: "furs", val: z.catpower * k / cz.costo * cz.furs }] });
    }
    return pasos;
  }

  // =================== MEDICIÓN DE PRODUCCIÓN ===================
  function prodActual() {
    game.village.updateHappines(); game.village.updateResourceProduction();
    var o = {};
    game.resPool.resources.forEach(function (r) { if (r.calculatePerTick) o[r.name] = game.calcResourcePerTick(r.name) * tps(); });
    game.bld.buildingsData.forEach(function (b) { // quitar lo que hoy aportan los conversores; se simulan aparte
      var ec = b.effectsCalculated; if (!b.on || !ec) return;
      if (!Object.keys(ec).some(function (k) { return /PerTickCon$/.test(k) && ec[k] < 0; })) return;
      Object.keys(ec).forEach(function (k) {
        if (/PerTickAutoprod$/.test(k)) { var r = k.slice(0, -15); if (r in o) o[r] -= (b.effects[k] || 0) * b.on * tps(); }
      });
    });
    return o;
  }
  function crudo() { game.village.updateResourceProduction(); return Object.assign({}, game.village.resourceProduction || {}); }

  // catnip según estación (sin clima frío/cálido)
  function catnipEstaciones() {
    var cal = game.calendar, s0 = cal.season, w0 = cal.weather, v = [];
    try { for (var s = 0; s < 4; s++) { cal.season = s; cal.weather = null; v.push(game.calcResourcePerTick("catnip") * tps()); } }
    finally { cal.season = s0; cal.weather = w0; }
    return { prom: (v[0] + v[1] + v[2] + v[3]) / 4, invierno: v[3], v: v };
  }

  function medir(nFijos) {
    var kittens = game.village.sim.kittens, orig = kittens.map(function (k) { return k.job; });
    var jobs = game.village.jobs.filter(function (j) { return j.unlocked && j.name !== "engineer"; }).map(function (j) { return j.name; });
    var orden = kittens.map(function (k, i) { return i; }).sort(function (a, b) {
      var la = kittens[a].isLeader ? 1 : 0, lb = kittens[b].isLeader ? 1 : 0;
      if (la !== lb) return la - lb;
      var fa = orig[a] === "farmer" ? 1 : 0, fb = orig[b] === "farmer" ? 1 : 0;
      if (fa !== fb) return fb - fa;
      return ((kittens[b].skills || {}).farmer || 0) - ((kittens[a].skills || {}).farmer || 0);
    });
    var fijos = orden.slice(0, nFijos), libres = orden.slice(nFijos), N = Math.max(1, libres.length);
    var cz = caza(), base, cat, m = {}, kit = libres.map(function (i) { return { idx: i, lider: !!kittens[i].isLeader, c: {}, s: {}, orig: orig[i] || null }; });
    function pasarCaza(o) { // el catpower se convierte en furs/ivory cazando
      var mp = o.manpower || 0; if (mp > 0) { o.furs = (o.furs || 0) + mp / cz.costo * cz.furs; o.ivory = (o.ivory || 0) + mp / cz.costo * cz.ivory; }
      return o;
    }
    try {
      fijos.forEach(function (i) { kittens[i].job = "farmer"; });
      libres.forEach(function (i) { kittens[i].job = null; });
      base = prodActual();
      cat = catnipEstaciones();
      var baseCrudo = crudo();
      jobs.forEach(function (j) {
        libres.forEach(function (i) { kittens[i].job = j; });
        var r = prodActual(), tot = {}, totCrudo = {}, cr = crudo();
        Object.keys(r).forEach(function (k) { var v = r[k] - base[k]; if (Math.abs(v) > 1e-9) tot[k] = v; });
        Object.keys(cr).forEach(function (k) { var v = cr[k] - (baseCrudo[k] || 0); if (Math.abs(v) > 1e-12) totCrudo[k] = v; });
        libres.forEach(function (i) { kittens[i].job = null; });
        libres.forEach(function (i, n) {
          kittens[i].job = j;
          var ci = crudo(), o = {};
          kittens[i].job = null;
          Object.keys(tot).forEach(function (k) {
            o[k] = totCrudo[k] ? tot[k] * ((ci[k] || 0) - (baseCrudo[k] || 0)) / totCrudo[k] : tot[k] / N;
          });
          kit[n].c[j] = o; // el catpower se pasa a caza más abajo
        });
        var mj = {}; Object.keys(tot).forEach(function (k) { mj[k] = tot[k] / N; });
        m[j] = mj;
      });
    } finally {
      kittens.forEach(function (k, i) { k.job = orig[i]; });
      game.village.updateHappines(); game.village.updateResourceProduction();
    }
    base.catnip = cat.prom; // promedio del año
    var conv = [];
    game.bld.buildingsData.forEach(function (b) {
      var ec = b.effectsCalculated; if (!b.on || !ec) return;
      var ins = {}, outs = {}, tiene = false;
      Object.keys(ec).forEach(function (k) {
        if (/PerTickCon$/.test(k) && ec[k] < 0) { ins[k.slice(0, -10)] = -ec[k] * b.on * tps(); tiene = true; }
        else if (/PerTickAutoprod$/.test(k) && ec[k] > 0) outs[k.slice(0, -15)] = ec[k] * b.on * tps();
      });
      if (tiene) conv.push({ nombre: b.name, ins: ins, outs: outs });
    });
    // el catpower que se comen los conversores (Mints → gold) no se caza: queda para ellos
    var mpConv = conv.reduce(function (a, c) { return a + (c.ins.manpower || 0); }, 0);
    var mpBase = base.manpower || 0, mpQueda = Math.min(Math.max(0, mpBase), mpConv);
    base.manpower = mpBase - mpQueda; pasarCaza(base); base.manpower = mpQueda;
    // lo que aportan los gatitos (hunters) se caza, salvo lo que falte para los conversores
    var faltaMp = mpConv - mpQueda, mpCrudo = {};
    jobs.forEach(function (j) {
      if (m[j].manpower) {
        var porGat = m[j].manpower, usa = Math.min(porGat, faltaMp / Math.max(1, N)); mpCrudo[j] = porGat; // catpower por gatito, sin cazar
        m[j].manpower = porGat - usa; pasarCaza(m[j]); m[j].manpower = usa;
      }
      kit.forEach(function (g) {
        var c = g.c[j]; if (!c.manpower) return;
        var usa2 = Math.min(c.manpower, faltaMp / Math.max(1, N)); c.manpower -= usa2; pasarCaza(c); c.manpower = usa2;
      });
    });
    kit.forEach(function (g) {
      jobs.forEach(function (j) {
        var sum = 0, n = 0;
        Object.keys(m[j]).forEach(function (k) { if (m[j][k] > 0) { sum += (g.c[j][k] || 0) / m[j][k]; n++; } });
        g.s[j] = n ? sum / n : 1;
      });
    });
    return { jobs: jobs, m: m, base: base, conv: conv, kit: kit, N: libres.length, fijos: fijos, nFijos: nFijos, cat: cat, caza: cz, cache: {}, mpCrudo: mpCrudo };
  }
  // sube los farmers fijos hasta que el catnip alcance (promedio del año y reserva para el invierno)
  function medirSeguro() {
    var nF = A.FARMERS_MIN, M, tot = game.village.sim.kittens.length;
    for (; nF <= tot; nF++) {
      M = medir(nF);
      var stock = R("catnip").value, inv = M.cat.invierno;
      // con los libres sin oficio: también comen
      if (M.base.catnip >= 0 && (inv >= 0 || stock + inv * 200 >= 0)) break;
    }
    return M;
  }

  // ---------- reparto concreto: qué gatito va a qué oficio ----------
  function asignar(M, a) {
    var cupo = {}, asig = M.kit.map(function () { return null; });
    Object.keys(a).forEach(function (j) { if (a[j] > 0) cupo[j] = a[j]; });
    // el líder rinde ~×10 en cualquier oficio: siempre al de la meta (el primero de a), no al de mantenimiento
    var jMeta = Object.keys(a).filter(function (j) { return cupo[j] > 0; })[0];
    M.kit.forEach(function (g, n) { if (g.lider && jMeta) { asig[n] = jMeta; cupo[jMeta]--; } });
    var pares = [];
    M.kit.forEach(function (g, n) { Object.keys(cupo).forEach(function (j) { pares.push([g.s[j] || 0, n, j]); }); });
    pares.sort(function (x, y) { return y[0] - x[0]; });
    pares.forEach(function (p) { if (asig[p[1]] === null && cupo[p[2]] > 0) { asig[p[1]] = p[2]; cupo[p[2]]--; } });
    return asig;
  }
  function tasas(M, a) {
    var key = JSON.stringify(a);
    if (M.cache[key]) return M.cache[key];
    var o = Object.assign({}, M.base);
    asignar(M, a).forEach(function (j, n) {
      if (!j) return; var c = M.kit[n].c[j]; Object.keys(c).forEach(function (r) { o[r] = (o[r] || 0) + c[r]; });
    });
    return (M.cache[key] = o);
  }
  function mejorJob(M, r) {
    var mejor = null, v = 0;
    M.jobs.forEach(function (j) { var x = (M.m[j] || {})[r] || 0; if (x > v) { v = x; mejor = j; } });
    return mejor;
  }

  // ---------- lo que falta (expandiendo fabricados) ----------
  function faltante(st, preciosLista) {
    var falta = {}, pool = {};
    function pedir(n, cant) {
      if (cant <= 1e-9) return;
      var hay = n in pool ? pool[n] : (st[n] || 0), usa = Math.min(hay, cant);
      pool[n] = hay - usa; cant -= usa;
      if (cant <= 1e-9) return;
      if (esFab(n)) { var ins = insumo(n); Object.keys(ins).forEach(function (q) { pedir(q, ins[q] * cant); }); }
      else falta[n] = (falta[n] || 0) + cant;
    }
    preciosLista.forEach(function (p) { p.forEach(function (x) { pedir(x.name, x.val); }); });
    return falta;
  }
  // política por etapas: todos los libres al oficio del recurso que más tarda
  // (una etapa a la vez: se queda en un oficio hasta juntar todo lo de ese oficio para la compra que sigue)
  // lo que sale de un conversor (iron de los Smelters) se traduce en lo que el conversor consume
  // (descuenta lo que ya hay guardado del insumo, si no se usó ya para otra cosa)
  function pasarConversores(M, falta, st) {
    var usado = {}; Object.keys(falta).forEach(function (q) { usado[q] = true; });
    Object.keys(falta).forEach(function (r) {
      if (mejorJob(M, r)) return;
      var c = M.conv.filter(function (x) { return x.outs[r] > 0; })[0]; if (!c) return;
      Object.keys(c.ins).forEach(function (q) {
        var nec = falta[r] * c.ins[q] / c.outs[r], hay = usado[q] ? 0 : ((st || {})[q] || 0);
        usado[q] = true;
        if (nec > hay) falta[q] = (falta[q] || 0) + nec - hay;
      });
    });
    return falta;
  }
  function politica(M, st, preciosLista, jobActual) {
    var stc = sinCol(st, colchones()); // la reserva de insumos no cuenta como disponible
    var falta = pasarConversores(M, faltante(stc, preciosLista), stc), peor = null, pt = -1, N = M.N, porJob = {}, recJob = {};
    Object.keys(falta).forEach(function (r) {
      var j = mejorJob(M, r); if (!j) return;
      var v = falta[r] / Math.max(1e-9, (M.base[r] || 0) + M.m[j][r] * N);
      // un recurso lleno que todavía "falta" (no se puede fabricar con él por ahora) no sirve para seguir en ese oficio
      var tope = R(r) && R(r).maxValue, lleno = tope > 0 && (st[r] || 0) >= tope * 0.99;
      if (!lleno && v > (porJob[j] || 0)) { porJob[j] = v; recJob[j] = r; }
      if (!lleno && v > pt) { pt = v; peor = j; }
    });
    // una etapa a la vez: se queda en el oficio actual hasta juntar todo lo de ese oficio, y recién ahí cambia
    if (jobActual && porJob[jobActual] > 0) peor = jobActual;
    ultimaEtapa = { job: peor, recurso: peor ? recJob[peor] : null, falta: peor ? falta[recJob[peor]] : 0 };
    if (!peor) peor = M.jobs.indexOf("scholar") >= 0 ? "scholar" : M.jobs[0];
    // primero los gatitos que mantienen andando lo escaso (gold, titanium); el resto, a la meta
    var mant = mantenimiento(M), usados = 0, a = {};
    a[peor] = 0;
    Object.keys(mant).forEach(function (j) { a[j] = (a[j] || 0) + mant[j]; usados += mant[j]; });
    a[peor] += N - usados;
    return a;
  }
  // recursos escasos: aunque la meta no los pida, se siguen produciendo porque frenan otras metas.
  // Calcula cuántos gatitos hacen falta para que los conversores que los producen
  // (Smelters → gold, Calciner → titanium) no se queden sin insumos (wood, minerals…).
  // Todos los edificios que consumen algo (Smelters, Calciner, Mints…) siguen andando:
  // se asignan los gatitos que hacen falta para producir sus insumos (wood, minerals, catpower…).
  function mantenimiento(M) {
    if (M.mant) return M.mant;
    var o = {};
    if (mantActivo()) {
      var total = 0, tope = Math.floor(M.N * A.ESCASOS_MAX_PCT);
      // cuántos gatitos hacen falta para producir "nec" por segundo de cada recurso (con margen: los que quedan
      // en mantenimiento rinden menos que el promedio, porque el líder y los mejores van a la meta)
      var gatitos = function (nec, conExtra) {
        var out = [];
        Object.keys(nec).forEach(function (q) {
          var j, por;
          if (q === "manpower") { // los hunters: su catpower sin contar lo que se caza
            j = Object.keys(M.mpCrudo || {}).sort(function (a, b) { return M.mpCrudo[b] - M.mpCrudo[a]; })[0]; por = j ? M.mpCrudo[j] : 0;
          } else { j = mejorJob(M, q); por = j ? M.m[j][q] : 0; }
          if (!j || !(por > 0)) return; // oil, gold…: no dependen de gatitos (para eso está la reserva y "sostener")
          var k = Math.ceil(Math.max(0, nec[q] * A.MANT_MARGEN - (conExtra ? (M.base[q] || 0) : 0)) / por) + (conExtra ? ((d.mantExtra || {})[j + "|" + q] || 0) : 0);
          if (k > 0) out.push({ j: j, k: k });
        });
        return out;
      };
      // 1.º: los insumos de todos los edificios que consumen (Smelters, Calciner, Mints…), con el consumo total que da el juego
      var nec = {};
      M.conv.forEach(function (c) { Object.keys(c.ins).forEach(function (q) { nec[q] = (nec[q] || 0) + c.ins[q]; }); });
      game.resPool.resources.forEach(function (r) { var c = consumoPorSeg(r.name); if (c > (nec[r.name] || 0)) nec[r.name] = c; });
      gatitos(nec, true).forEach(function (x) { var k = Math.min(x.k, tope - total); if (k > 0) { o[x.j] = (o[x.j] || 0) + k; total += k; } });
      // 2.º: lo que piden los tratos gold → titanium (minerals para los slabs y catpower); si no entra todo, en proporción
      var tr = gatitos(slabsParaTratos(M), false), pide = tr.reduce(function (s, x) { return s + x.k; }, 0), queda = tope - total;
      if (pide > 0 && queda > 0) {
        var f = Math.min(1, queda / pide);
        tr.forEach(function (x) { var k = Math.max(1, Math.floor(x.k * f)); k = Math.min(k, tope - total); if (k > 0) { o[x.j] = (o[x.j] || 0) + k; total += k; } });
      }
    }
    return (M.mant = o);
  }
  // insumos por segundo para hacer los slabs que piden los tratos con el gold que se produce
  function slabsParaTratos(M) {
    var o = {}; if (!d.on.oroTitanio) return o;
    var z = zebras(); if (!z || !rec(z.compra)) return o;
    var ti = R("titanium"); if (ti.maxValue && ti.value >= ti.maxValue * 0.98) return o;
    var oro = (M.base.gold || 0); M.conv.forEach(function (c) { oro += c.outs.gold || 0; });
    if (!(oro > 0)) return o;
    var porSeg = oro / z.gold * z.compraVal, ins = insumo(z.compra); // slabs por segundo y lo que lleva cada uno
    Object.keys(ins).forEach(function (q) { if (!esFab(q)) o[q] = ins[q] * porSeg; });
    o.manpower = (o.manpower || 0) + oro / z.gold * z.catpower; // y el catpower de cada trato (hunters)
    return o;
  }
  // ajuste con la realidad: si un insumo de mantenimiento igual baja, un gatito más a ese oficio (y uno menos si sobra mucho)
  function ajustarMantenimiento(M) {
    d.mantExtra = d.mantExtra || {};
    var nec = {};
    M.conv.forEach(function (c) { Object.keys(c.ins).forEach(function (q) { nec[q] = (nec[q] || 0) + c.ins[q]; }); });
    game.resPool.resources.forEach(function (r) { var c = consumoPorSeg(r.name); if (c > (nec[r.name] || 0)) nec[r.name] = c; });
    Object.keys(nec).forEach(function (q) {
      var j = q === "manpower" ? Object.keys(M.mpCrudo || {}).sort(function (a, b) { return M.mpCrudo[b] - M.mpCrudo[a]; })[0] : mejorJob(M, q); if (!j) return;
      var r = R(q), neto = (game.getResourcePerTick(q, true) || 0) * tps(), clave = j + "|" + q, ex = d.mantExtra[clave] || 0;
      if (neto < 0 && !(r.maxValue && r.value >= r.maxValue * 0.98)) d.mantExtra[clave] = Math.min(ex + 1, 15);
      else if (ex > 0 && neto > nec[q] * 0.25) d.mantExtra[clave] = ex - 1;
    });
  }
  // cuánto consumen por segundo los edificios encendidos (Con = conversores; PerTick negativo = Magneto con el oil)
  // Consumo por edificio que el juego recalcula según lo que hay (js/buildings.js, "action"): si el insumo se acabó,
  // el juego informa 0, pero el edificio lo consume apenas aparece. Para eso se usa el consumo completo.
  var CONSUMO_BASE = { mint: { manpower: 0.75, gold: 0.005 } };
  function consumoPorSeg(r) {
    var c = -Math.min(0, game.getEffect(r + "PerTickCon") || 0), extra = 0;
    game.bld.buildingsData.forEach(function (b) {
      var v = (b.effects || {})[r + "PerTick"]; if (v < 0 && b.on) c += -v * b.on;
      var base = (CONSUMO_BASE[b.name] || {})[r];
      if (base && b.on) extra += Math.max(0, base * b.on + Math.min(0, (b.effects || {})[r + "PerTickCon"] || 0)); // lo que le falta para el consumo completo
    });
    return (c + extra) * tps();
  }
  // reserva de insumos que nadie gasta, para que esos edificios no se queden sin nada y se apaguen
  // la reserva nunca impide una compra que llena justo el tope
  function colPara(col, x, tope) { return Math.max(0, Math.min(col[x.name] || 0, (tope || Infinity) - x.val)); }
  // stock sin la reserva de insumos (lo que de verdad se puede usar)
  function sinCol(st, col) { var o = Object.assign({}, st); Object.keys(col || {}).forEach(function (r) { o[r] = Math.max(0, (o[r] || 0) - col[r]); }); return o; }
  function colchones() {
    var o = {}; if (!mantActivo()) return o;
    game.resPool.resources.forEach(function (r) { var c = consumoPorSeg(r.name); if (c > 0) o[r.name] = c * A.COLCHON_SEG; });
    return o;
  }
  // edificios que gastan recursos y el juego apagó (p. ej. Magnetos sin oil): se vuelven a encender si hay insumos
  function encenderConsumidores() {
    game.bld.buildingsData.forEach(function (b) {
      if (!b.val || typeof b.on !== "number" || b.on >= b.val) return;
      var ef = b.effects || {}, ins = Object.keys(ef).filter(function (k) { return /PerTick(Con)?$/.test(k) && ef[k] < 0; });
      if (!ins.length) return;
      var hay = ins.every(function (k) {
        var r = k.replace(/PerTick(Con)?$/, ""), por = -ef[k] * b.val * tps(); // lo que gastarían todos encendidos
        return R(r) && R(r).value >= por * A.COLCHON_SEG;
      });
      if (!hay) return;
      var antes = b.on; game.bld.getBuildingExt(b.name).set("on", b.val); refrescar(b);
      anotar("Encendí " + (b.val - antes) + " " + etiqueta("buildings", b.name) + " (estaban apagados)");
    });
  }

  // =================== SIMULACIÓN ===================
  // items: [{p: precios, cap: {res: +tope}, gana: {res: +cantidad}, M: medición después de comprarlo}]
  // Avanza "por saltos": entre un evento y otro (se alcanza una compra, algo se llena o se vacía,
  // toca revisar el reparto) todo produce a ritmo constante, así que salta directo al siguiente evento.
  var SIM_MAX_SALTO = 300, SIM_MIN_SALTO = 1, SIM_REPARTO_SEG = 60;

  // ritmo neto por segundo con los conversores (Smelters, Calciner…) y lo que se pierde por estar lleno
  function netos(M, rates, st, cap) {
    var net = Object.assign({}, rates), cons = {}, sobra = {};
    M.conv.forEach(function (c) { Object.keys(c.ins).forEach(function (q) { cons[q] = (cons[q] || 0) + c.ins[q]; }); });
    M.conv.forEach(function (c) {
      var f = 1; // si un insumo está en 0, el conversor anda solo con lo que va entrando
      Object.keys(c.ins).forEach(function (q) { if ((st[q] || 0) <= 1e-6) f = Math.min(f, Math.max(0, rates[q] || 0) / cons[q]); });
      Object.keys(c.ins).forEach(function (q) { net[q] = (net[q] || 0) - c.ins[q] * f; });
      Object.keys(c.outs).forEach(function (r) { net[r] = (net[r] || 0) + c.outs[r] * f; });
    });
    Object.keys(net).forEach(function (r) {
      if (net[r] > 0 && isFinite(cap[r]) && (st[r] || 0) >= cap[r] - 1e-6) { sobra[r] = net[r]; net[r] = 0; }
    });
    return { net: net, sobra: sobra };
  }
  function sumarGana(items) {
    var g = {}; items.forEach(function (it) { Object.keys(it.gana || {}).forEach(function (r) { g[r] = (g[r] || 0) + it.gana[r]; }); });
    return g;
  }
  // lo que gastan los automáticos mientras corre el plan (para que la simulación se parezca a la realidad)
  function automaticosSim(st, cap, net, sobra, dt, resRaw, col, t, est) {
    Object.keys(est.ritmo || {}).forEach(function (q) { est.cuenta[q] = Math.min(est.ritmo[q] * 3600, (est.cuenta[q] || 0) + est.ritmo[q] * dt); });
    var libreS = function (r) { return (st[r] || 0) - (resRaw[r] || 0) - (col[r] || 0); };
    // beam/slab/plate con lo que se desborda (el automático hace 1 fabricación por segundo)
    if (d.on.bsp) [["wood", "beam"], ["minerals", "slab"], ["iron", "plate"]].forEach(function (x) {
      var r = x[0], prod = x[1], rc = rec(prod); if (!(sobra[r] > 0) || !rc) return;
      var porVez = rc.porVez[r] || 0; if (!porVez) return;
      var usa = Math.min(sobra[r], porVez) * dt; // como mucho una fabricación por segundo
      st[prod] = (st[prod] || 0) + usa / porVez * rc.rinde;
    });
    // steel cada 60 s con el coal y el iron que el plan no necesita
    if (d.on.steel && t - est.ultSteel >= A.STEEL_CADA_SEG && rec("steel")) {
      est.ultSteel = t;
      var ins = insumo("steel"), u = Infinity;
      Object.keys(ins).forEach(function (q) { u = Math.min(u, Math.max(0, libreS(q)) / ins[q]); });
      if (isFinite(u) && u > 0) { Object.keys(ins).forEach(function (q) { st[q] -= ins[q] * u; }); st.steel = (st.steel || 0) + u; }
    }
    // manuscripts con la culture al 90 % (el parchment sale de los furs, dejando la reserva)
    if (d.on.manuscript && isFinite(cap.culture) && (st.culture || 0) >= cap.culture * A.CULTURA_PCT && rec("manuscript")) {
      var im = insumo("manuscript"), parch = im.parchment || 0, cult = im.culture || 0, ip = rec("parchment") ? insumo("parchment") : null;
      var pDisp = Math.max(0, libreS("parchment")), fDisp = Math.max(0, libreS("furs") - A.RESERVA_FURS);
      var parchPosible = pDisp + (ip && ip.furs ? fDisp / ip.furs : 0);
      var um = Math.min(cult ? Math.max(0, libreS("culture")) / cult : Infinity, parch ? parchPosible / parch : Infinity);
      if (isFinite(um) && um > 0) {
        var pUsa = um * parch, deParch = Math.min(pUsa, pDisp), hacerP = pUsa - deParch;
        st.parchment -= deParch; if (ip && ip.furs) st.furs -= hacerP * ip.furs;
        st.culture -= um * cult; st.manuscript = (st.manuscript || 0) + um;
      }
    }
    // gold casi lleno → titanium con las Zebras
    if (d.on.oroTitanio && est.z && isFinite(cap.gold) && (st.gold || 0) >= cap.gold * A.ORO_TRATOS_PCT &&
        !(isFinite(cap.titanium) && (st.titanium || 0) >= cap.titanium * 0.98)) {
      var z = est.z, fursTrato = z.catpower / est.cz.costo * est.cz.furs;
      var n = Math.floor(((st.gold || 0) - Math.max(cap.gold * A.ORO_DEJAR_PCT, (resRaw.gold || 0) + (col.gold || 0))) / z.gold);
      // los slabs que falten se fabrican con lo que sobra (igual que en el juego)
      var insC = rec(z.compra) ? insumo(z.compra) : null, porFab = Infinity;
      // para los slabs vale la "cuenta aparte" de los miners extra, aunque el plan reserve esos minerals
      var libreT = function (q) { return (st[q] || 0) - (col[q] || 0) - Math.max(0, (resRaw[q] || 0) - (est.cuenta[q] || 0)); };
      if (insC) Object.keys(insC).forEach(function (q) { porFab = Math.min(porFab, Math.max(0, libreT(q)) / insC[q]); });
      if (!isFinite(porFab)) porFab = 0;
      var slabsDisp = Math.max(0, libreS(z.compra)) + porFab;
      n = Math.min(n, Math.floor(slabsDisp / z.compraVal), Math.floor(Math.max(0, libreS("furs") - A.RESERVA_FURS) / fursTrato));
      if (n >= 1) {
        var hacerS = Math.max(0, n * z.compraVal - Math.max(0, libreS(z.compra)));
        if (hacerS > 0 && insC) { Object.keys(insC).forEach(function (q) { st[q] -= insC[q] * hacerS; est.cuenta[q] = Math.max(0, (est.cuenta[q] || 0) - insC[q] * hacerS); }); st[z.compra] = (st[z.compra] || 0) + hacerS; }
        st.gold -= n * z.gold; st[z.compra] -= n * z.compraVal; st.furs -= n * fursTrato;
        st.titanium = Math.min(isFinite(cap.titanium) ? cap.titanium : Infinity, (st.titanium || 0) + n * z.ti);
      }
    }
  }

  function simular(M, items, st0, capExtra, limiteSeg) {
    var st = {}, cap = {};
    game.resPool.resources.forEach(function (r) { st[r.name] = st0 ? (st0[r.name] || 0) : r.value; cap[r.name] = r.maxValue ? r.maxValue + ((capExtra || {})[r.name] || 0) : Infinity; });
    var k = 0, t = 0, limite = limiteSeg || A.HORAS_MAX * 3600, alloc = null, rates = null, etapas = [], ultPol = -1e9;
    var col = colchones(); // la compra deja la reserva de insumos de los edificios que consumen
    var hist = [], resRaw = null, kRes = -1;
    var est = { ultSteel: 0, z: null, cz: caza(), barcos0: R("ship").value, ritmo: mantActivo() ? slabsParaTratos(M) : {}, cuenta: {} };
    var hacer = function (n, cant, nivel, reserva) {
      if (cant <= 1e-9 || nivel > 6) return;
      var ins = insumo(n);
      Object.keys(ins).forEach(function (q) {
        if (!esFab(q)) return;
        var nec = ins[q] * cant + (reserva[q] || 0) - (st[q] || 0);
        if (nec > 0) hacer(q, nec, nivel + 1, reserva);
      });
      var mm = cant;
      Object.keys(ins).forEach(function (q) { mm = Math.min(mm, Math.max(0, (st[q] || 0) - (reserva[q] || 0)) / ins[q]); });
      if (mm > 0) { Object.keys(ins).forEach(function (q) { st[q] -= ins[q] * mm; }); st[n] = (st[n] || 0) + mm; }
    };
    var guardia = 0;
    while (k < items.length && t < limite && guardia++ < 200000) {
      if (kRes !== k) { // lo que el resto del plan necesita: los automáticos de la simulación no lo tocan
        kRes = k; resRaw = faltante({}, items.slice(k).map(function (x) { return x.p; }));
        est.z = zebras((st.ship || 0) - est.barcos0);
      }
      if (alloc === null || t - ultPol >= SIM_REPARTO_SEG) {
        // el reparto apunta a la compra que sigue (lo que tiene tope no se puede juntar por adelantado)
        var na = politica(M, st, [items[k].p], alloc ? Object.keys(alloc)[0] : null), nj = Object.keys(na)[0];
        var ue = ultimaEtapa || {}, ult = etapas[etapas.length - 1];
        if (!ult || ult.job !== nj || ult.paso !== k || ult.recurso !== ue.recurso) etapas.push({ job: nj, desde: t, paso: k, recurso: ue.job === nj ? ue.recurso : null });
        alloc = na; rates = tasas(M, alloc); ultPol = t;
      }
      // fabricar en cadena lo que pide la compra actual (sin tocar lo fabricado que el edificio pide directo)
      var pr = items[k].p, reserva = Object.assign({}, col); // al fabricar tampoco se toca la reserva de insumos
      pr.forEach(function (y) { if (esFab(y.name)) reserva[y.name] = (reserva[y.name] || 0) + y.val; });
      pr.forEach(function (x) {
        if (!esFab(x.name)) return;
        var falta = x.val - (st[x.name] || 0); if (falta <= 0) return;
        reserva[x.name] = 0; hacer(x.name, falta, 0, reserva); reserva[x.name] = x.val;
      });
      var compro = false;
      while (k < items.length && items[k].p.every(function (x) { return (st[x.name] || 0) >= x.val + colPara(col, x, cap[x.name]) - 1e-6; })) {
        items[k].p.forEach(function (x) { st[x.name] -= x.val; });
        var it = items[k];
        if (it.cap) Object.keys(it.cap).forEach(function (r) { cap[r] = (cap[r] || 0) + it.cap[r]; });
        if (it.gana) Object.keys(it.gana).forEach(function (r) { st[r] = Math.min(isFinite(cap[r]) ? cap[r] : Infinity, (st[r] || 0) + it.gana[r]); });
        if (it.M) M = it.M;
        it.t = t; k++; alloc = null; compro = true;
      }
      if (compro || k >= items.length) continue; // con la compra hecha, nuevo reparto antes de avanzar
      var nn = netos(M, rates, st, cap), net = nn.net;
      // ¿cuánto falta para el próximo evento?
      var dt = Math.min(SIM_MAX_SALTO, SIM_REPARTO_SEG - (t - ultPol), limite - t);
      var fa = faltante(sinCol(st, col), [items[k].p]), tAlc = 0;
      Object.keys(fa).forEach(function (r) { tAlc = Math.max(tAlc, (net[r] || 0) > 1e-9 ? fa[r] / net[r] : Infinity); });
      if (tAlc > 0) dt = Math.min(dt, tAlc);
      Object.keys(net).forEach(function (r) {
        var v = net[r], s = st[r] || 0;
        if (v > 1e-9 && isFinite(cap[r]) && s < cap[r]) dt = Math.min(dt, (cap[r] - s) / v);
        if (v < -1e-9 && s > 1e-6) dt = Math.min(dt, s / -v);
      });
      dt = Math.max(SIM_MIN_SALTO, dt);
      Object.keys(net).forEach(function (r) { st[r] = Math.max(0, Math.min(isFinite(cap[r]) ? cap[r] : Infinity, (st[r] || 0) + net[r] * dt)); });
      automaticosSim(st, cap, net, nn.sobra, dt, resRaw, col, t, est);
      hist.push({ dt: dt, net: net });
      t += dt;
    }
    if (k >= items.length) return { t: t, tEst: t, compradas: k, st: st, etapas: etapas };
    return Object.assign({ t: Infinity, compradas: k, st: st, etapas: etapas, limite: t }, estimarResto(M, st, cap, col, items.slice(k), t, hist));
  }

  // No terminó en el límite: estima cuánto más falta repartiendo a los gatitos entre lo que falta
  // (busca por mitades el menor tiempo T en que los libres alcanzan para todo).
  function estimarResto(M, st, cap, col, resto, t, hist) {
    var precios = resto.map(function (x) { return x.p; }), gana = sumarGana(resto);
    var falta = faltante(sinCol(st, col), precios), total = faltante({}, precios);
    // lo que dan los pasos que faltan (titanium de los tratos, barcos) no hace falta producirlo
    Object.keys(gana).forEach(function (r) { if (falta[r]) { falta[r] = Math.max(0, falta[r] - gana[r]); if (falta[r] <= 1e-9) delete falta[r]; } });
    // si los conversores no se mantienen solos, lo que sale de ellos se traduce en sus insumos
    if (!mantActivo()) pasarConversores(M, falta, st);
    // ¿algo de un solo paso no cabe en el tope?
    var noCabe = {};
    resto.forEach(function (it) { it.p.forEach(function (x) { if (isFinite(cap[x.name]) && x.val + colPara(col, x, Infinity) > cap[x.name] + 1e-6) noCabe[x.name] = true; }); });
    // ritmo base: los gatitos de mantenimiento + lo que no depende de gatitos; los conversores a pleno
    var mant = mantenimiento(M), libres = M.N, a = {};
    Object.keys(mant).forEach(function (j) { a[j] = mant[j]; libres -= mant[j]; });
    var base = tasas(M, a), convMax = {};
    M.conv.forEach(function (c) { Object.keys(c.outs).forEach(function (r) { convMax[r] = (convMax[r] || 0) + c.outs[r]; }); });
    var alcanza = function (T) {
      var porJob = {};
      return Object.keys(falta).every(function (r) {
        var need = falta[r] / T, b = (base[r] || 0) + (convMax[r] || 0), j = mejorJob(M, r);
        if (need <= b) return true;
        if (!j) return false;
        porJob[j] = Math.max(porJob[j] || 0, (need - b) / M.m[j][r]); // un oficio puede dar varios recursos a la vez (hunter: furs e ivory)
        return true;
      }) && Object.keys(porJob).reduce(function (s, j) { return s + porJob[j]; }, 0) <= libres;
    };
    var T = Infinity;
    if (!Object.keys(noCabe).length && alcanza(1e9)) {
      var lo = 1, hi = 1e9;
      for (var i = 0; i < 60; i++) { var mid = Math.sqrt(lo * hi); if (alcanza(mid)) hi = mid; else lo = mid; }
      T = hi;
    }
    if (!Object.keys(falta).length && !Object.keys(noCabe).length) T = 0;
    // ritmo promedio de la última hora simulada (para mostrar)
    var prom = {}, acum = 0;
    for (var h = hist.length - 1; h >= 0 && acum < 3600; h--) {
      var e = hist[h], w = Math.min(e.dt, 3600 - acum); acum += w;
      Object.keys(e.net).forEach(function (r) { prom[r] = (prom[r] || 0) + e.net[r] * w; });
    }
    Object.keys(prom).forEach(function (r) { prom[r] /= Math.max(1, acum); });
    var avance = Object.keys(falta).map(function (r) {
      var v = prom[r] || 0;
      return { r: r, falta: falta[r], pct: total[r] > 0 ? Math.max(0, 1 - falta[r] / total[r]) : 0, porSeg: v,
        t: noCabe[r] ? Infinity : v > 1e-9 ? falta[r] / v : Infinity, noCabe: !!noCabe[r] };
    });
    avance.sort(function (a, b) { return b.t - a.t; });
    return { tEst: t + T, avance: avance, noCabe: Object.keys(noCabe) };
  }
  // tiempo para comparar planes: el real si termina en el límite; si no, el estimado
  function tcomp(r) { return isFinite(r.t) ? r.t : r.tEst; }
  function tiempoPlan(r) { return isFinite(r.t) ? tiempo(r.t) : isFinite(r.tEst) ? "más de " + textoLimite() + " (unas " + tiempo(r.tEst) + ", repartiendo a los gatitos entre lo que falta)" : "nunca a este ritmo"; }
  // con el historial: cuánto tardaría si se equivoca como en tus últimas metas
  function textoCorregido(sim) {
    var fh = factorHistorial(), t = tcomp(sim); if (!fh || !isFinite(t) || Math.abs(fh.f - 1) < 0.05) return "";
    return " <span style='color:#9aa3b2'>(según tus últimas " + fh.n + " metas, más bien ~" + tiempo(t * fh.f) + ")</span>";
  }
  function textoAhorro(x) { return isFinite(x) ? tiempo(x) : "la hace posible"; }

  // =================== ALMACENAMIENTO Y EDIFICIOS ===================
  function refrescar(meta) { game.updateCaches(); if (meta && meta.calculateEffects) meta.calculateEffects(meta, game); game.updateCaches(); }
  function ajustar(name, dd) {
    var meta = game.bld.get(name), ext = game.bld.getBuildingExt(name);
    ext.set("val", meta.val + dd); if (typeof meta.on === "number") ext.set("on", meta.on + dd);
    return meta;
  }
  function guardarEfectos(name) {
    var meta = game.bld.get(name), copias = [];
    [meta.effects, meta.effectsCalculated].concat((meta.stages || []).map(function (s) { return s.effects; }))
      .forEach(function (o) { if (o && typeof o === "object") copias.push([o, Object.assign({}, o)]); });
    return function () {
      copias.forEach(function (c) { Object.keys(c[0]).forEach(function (k) { if (!(k in c[1])) delete c[0][k]; }); Object.assign(c[0], c[1]); });
      game.updateCaches();
    };
  }
  // corre fn() como si tuvieras un edificio más, y deja todo como estaba
  function conEdificio(name, fn) {
    var restaurar = guardarEfectos(name), meta;
    try { meta = ajustar(name, 1); refrescar(meta); return fn(); }
    finally {
      if (meta) { ajustar(name, -1); refrescar(meta); }
      restaurar();
      game.resPool.resources.forEach(function (r) { game.resPool.updateMaxValue(r); });
    }
  }
  function topes() { var o = {}; game.resPool.resources.forEach(function (r) { game.resPool.updateMaxValue(r); o[r.name] = r.maxValue; }); return o; }

  // tope que falta: algo que se paga de una vez (o por fabricación) y no cabe
  function topeFaltante(p) {
    var falta = {};
    function revisar(n, cant) {
      var r = R(n); if (r && r.maxValue > 0 && cant > r.maxValue) falta[n] = Math.max(falta[n] || 0, cant - r.maxValue);
    }
    function porFab(n, nivel) { if (!esFab(n) || nivel > 6) return; var pv = rec(n).porVez; Object.keys(pv).forEach(function (q) { revisar(q, pv[q]); porFab(q, nivel + 1); }); }
    p.forEach(function (x) { revisar(x.name, x.val); porFab(x.name, 0); });
    return falta;
  }
  // tiempo aproximado para juntar unos precios, con el reparto por etapas

  async function planAlmacen(M, pMeta) {
    var falta = topeFaltante(pMeta), pasos = [], extra = {};
    var recursos = Object.keys(falta); if (!recursos.length) return { pasos: [], extra: {} };
    var t0 = topes(), cand = [];
    game.bld.buildingsData.forEach(function (b) {
      if (!b.unlocked) return;
      var dmax = null;
      try { dmax = conEdificio(b.name, function () { var t1 = topes(), o = {}; recursos.forEach(function (r) { o[r] = (t1[r] || 0) - (t0[r] || 0); }); return o; }); } catch (e) { return; }
      if (!recursos.some(function (r) { return dmax[r] > 1e-6; })) return;
      cand.push({ name: b.name, dmax: dmax });
    });
    await esperar();
    if (!cand.length) return { pasos: [], extra: {}, imposible: falta };
    // por cada recurso que falta: prueba cubrirlo solo con un tipo de edificio y elige el que,
    // contando todo (edificios + meta), termina antes
    for (var ir = 0; ir < recursos.length; ir++) {
      var r = recursos[ir], mejor = null;
      for (var ic = 0; ic < cand.length; ic++) (function (c) {
        if (!(c.dmax[r] > 1e-6)) return;
        var lista = [], acum = 0, yaHay = pasos.filter(function (x) { return x.name === c.name; }).length, extraC = Object.assign({}, extra);
        for (var n = 0; acum < falta[r] - 1e-6 && n < 40; n++) {
          var p = game.bld.getPrices(c.name, yaHay + n);
          if (!p.every(function (x) { var rr = R(x.name); return !rr.maxValue || x.val <= rr.maxValue + (extraC[x.name] || 0); })) return; // no cabe
          lista.push({ type: "buildings", name: c.name, p: p, cap: c.dmax, motivo: "almacenamiento" });
          acum += c.dmax[r];
          Object.keys(c.dmax).forEach(function (q) { extraC[q] = (extraC[q] || 0) + c.dmax[q]; });
        }
        if (acum < falta[r] - 1e-6) return;
        var todos = pasos.concat(lista).map(function (x) { return { p: x.p, cap: x.cap }; }).concat([{ p: pMeta }]);
        var t = tcomp(simular(M, todos, null, null));
        if (!mejor || t < mejor.t || (!isFinite(mejor.t) && lista.length < mejor.lista.length)) mejor = { t: t, lista: lista, extraC: extraC };
      })(cand[ic]), await esperar();
      if (!mejor) continue;
      pasos = pasos.concat(mejor.lista); extra = mejor.extraC; falta[r] = 0;
    }
    return { pasos: pasos, extra: extra, imposible: recursos.some(function (r) { return falta[r] > 1e-6; }) ? falta : null };
  }

  // edificios que adelantan la meta (contando lo que cuestan)
  async function planAyudas(M, items, tBase) {
    var stock = {}; game.resPool.resources.forEach(function (r) { stock[r.name] = r.value; });
    var necesarios = faltante(stock, items.map(function (i) { return i.p; }));
    var nec = Object.keys(necesarios); if (!nec.length) return [];
    if (necesarios.furs || necesarios.ivory) nec.push("manpower");
    var elegidos = [], M0 = M;
    var nombres = function () { return elegidos.map(function (e) { return e.name; }); };
    var itemsElegidos = function () { return elegidos.map(function (e) { return { p: e.p, M: e.M }; }); };
    for (var vuelta = 0; vuelta < A.MAX_EDIFICIOS_AYUDA; vuelta++) {
      var cand = [];
      // todo se mide como si ya tuvieras los edificios elegidos antes (así el 2.º Oil Well cuenta sobre el 1.º)
      conVarios(nombres(), function () {
        var baseRates = prodActual();
        game.bld.buildingsData.forEach(function (b) {
          if (!b.unlocked || consumeSinSostener(b, M0)) return; // p. ej. un Magneto más con el oil bajando
          var p = game.bld.getPrices(b.name, elegidos.filter(function (e) { return e.name === b.name; }).length);
          if (game.resPool.isStorageLimited(p)) return; // no cabe en tu almacenamiento (función del juego)
          var delta;
          try { delta = conEdificio(b.name, function () { var o = prodActual(); var dd = {}; nec.forEach(function (r) { dd[r] = (o[r] || 0) - (baseRates[r] || 0); }); return dd; }); } catch (e) { return; }
          // sirve si sube la producción de algo necesario (o lo potencia aunque hoy nadie trabaje en eso)
          var gana = nec.some(function (r) { return delta[r] > 1e-9; }) ||
            Object.keys(b.effects || {}).some(function (k) { return !/Max$/.test(k) && nec.some(function (r) { return k.indexOf(r) === 0 && (b.effects[k] || 0) > 0; }); });
          if (gana) cand.push({ name: b.name, p: p, delta: delta });
        });
      });
      var mejor = null;
      // primero los más prometedores: cuánto acelera lo que falta (pesado por lo que tarda cada recurso) ÷ cuánto cuesta
      var ritmos = prodActual();
      cand.forEach(function (c) {
        var gana = 0;
        nec.forEach(function (r) {
          var b = Math.max(1e-6, ritmos[r] || 0), peso = (necesarios[r] || 0) / b; // segundos que tardaría ese recurso
          if (c.delta[r] > 0) gana += peso * c.delta[r] / b;
        });
        var costo = 1 + c.p.reduce(function (s, x) { var rr = R(x.name); return s + x.val / Math.max(1, rr.maxValue || rr.value || 1); }, 0);
        c.puntaje = gana / costo;
      });
      cand.sort(function (a, b) { return b.puntaje - a.puntaje; });
      cand = cand.slice(0, 12);
      for (var ic = 0; ic < cand.length; ic++) {
        var c = cand[ic], M2;
        try { M2 = conVarios(nombres().concat([c.name]), function () { return medir(M0.nFijos); }); } catch (e) { continue; }
        var r = simular(M0, itemsElegidos().concat([{ p: c.p, M: M2 }]).concat(items));
        var tr = tcomp(r), ahorro = tBase - tr;
        if (ahorro > 60 && (!mejor || ahorro > mejor.ahorro)) mejor = { c: c, M2: M2, ahorro: ahorro, t: tr };
        await esperar();
      }
      if (!mejor) break;
      elegidos.push({ type: "buildings", name: mejor.c.name, p: mejor.c.p, M: mejor.M2, motivo: "adelanta la meta", ahorro: mejor.ahorro });
      tBase = mejor.t;
    }
    return elegidos;
  }
  // corre fn() como si tuvieras +1 de cada edificio de la lista (puede repetir), y deja todo como estaba
  function conVarios(lista, fn) {
    if (!lista.length) return fn();
    return conEdificio(lista[0], function () { return conVarios(lista.slice(1), fn); });
  }

  // barcos: cada uno sube la probabilidad (+0,35 %) y la cantidad (+0,03) de titanium por trato.
  // Prueba fabricar más barcos antes de comerciar y se queda con la cantidad que termina antes.
  async function planBarcos(M, prev, tratosAhora, pMeta, faltaTi, tBase) {
    var r = rec("ship"); if (!r || !tratosAhora.length) return null;
    var porVez = Object.keys(r.porVez).map(function (q) { return { name: q, val: r.porVez[q] }; });
    var mejor = null, peores = 0, hay = R("ship").value;
    var pruebas = [1, 2, 3, 5, 8, 12, 17, 25, 35, 50];
    for (var i = 0; i < pruebas.length; i++) {
      var veces = pruebas[i], extra = veces * r.rinde;
      if (hay + extra > A.MAX_BARCOS + r.rinde) break;
      var tr = pasosComercio(faltaTi, extra);
      var paso = { type: "ship", name: "ship", veces: veces, barcos: extra, motivo: "barcos",
        p: porVez.map(function (x) { return { name: x.name, val: x.val * veces }; }), gana: { ship: extra } };
      var items = prev.concat([{ p: paso.p, gana: paso.gana }]).concat(tr.map(function (s) { return { p: s.p, gana: s.gana }; })).concat([{ p: pMeta }]);
      var t = tcomp(simular(M, items));
      await esperar();
      var ref = mejor ? mejor.t : tBase;
      if (t < ref - 60) { mejor = { paso: paso, tratos: tr, t: t }; peores = 0; }
      else if (++peores >= 2) break; // ya no mejora
    }
    if (mejor) mejor.paso.ahorro = tBase - mejor.t;
    return mejor;
  }

  // =================== QUE NO SE ACABE NADA ===================
  // ¿el edificio consume algo que no depende de gatitos y ya va bajando (o quedaría bajando)?
  function consumeSinSostener(b, M) {
    if (!mantActivo()) return false;
    var ef = b.effects || {};
    return Object.keys(ef).some(function (k) {
      if (!/PerTick(Con)?$/.test(k) || !(ef[k] < 0)) return false;
      var r = k.replace(/PerTick(Con)?$/, ""); if (mejorJob(M, r)) return false;
      var neto = (game.getResourcePerTick(r, true) || 0) * tps();
      return neto + ef[k] * tps() < 0; // con uno más, quedaría en negativo
    });
  }
  // Recursos que tus edificios consumen, que no dependen de gatitos y que van bajando (p. ej. oil con Magnetos
  // y Calciners): agrega al principio del plan los edificios que más los suben por lo que cuestan (Oil Wells).
  function planSostener(M) {
    var pasos = []; if (!mantActivo()) return pasos;
    game.resPool.resources.forEach(function (res) {
      var r = res.name, cons = consumoPorSeg(r); if (!(cons > 0)) return;
      if (mejorJob(M, r)) return; // de esos se encargan los gatitos de mantenimiento
      var neto = (game.getResourcePerTick(r, true) || 0) * tps(); if (neto >= 0) return;
      var mejor = null;
      game.bld.buildingsData.forEach(function (b) {
        if (!b.unlocked) return;
        var p = game.bld.getPrices(b.name); if (!p.length || game.resPool.isStorageLimited(p)) return;
        var sube;
        try { sube = conEdificio(b.name, function () { return (game.getResourcePerTick(r, true) || 0) * tps(); }) - neto; } catch (e) { return; }
        if (!(sube > 1e-6)) return;
        var costo = 1 + p.reduce(function (s, x) { var rr = R(x.name); return s + x.val / Math.max(1, rr.maxValue || rr.value || 1); }, 0);
        if (!mejor || sube / costo > mejor.v) mejor = { name: b.name, sube: sube, v: sube / costo };
      });
      if (!mejor) return;
      var n = Math.min(A.SOSTENER_MAX, Math.ceil(-neto / mejor.sube));
      for (var i = 0; i < n; i++) {
        var p = game.bld.getPrices(mejor.name, i); if (game.resPool.isStorageLimited(p)) break;
        pasos.push({ type: "buildings", name: mejor.name, p: p, motivo: "sostener", recurso: r });
      }
      anotar("Sostener: " + titulo(r) + " baja " + num(-neto) + "/s → " + n + " " + etiqueta("buildings", mejor.name) + " (+" + num(mejor.sube) + "/s c/u)");
    });
    return pasos;
  }

  // =================== MODO EDIFICIOS (después de la meta) ===================
  // candidatos: edificios desbloqueados que caben en el almacenamiento, ordenados por cuánto tardan
  async function rankingEdificios() {
    var M = medirSeguro(), lista = [];
    await esperar();
    var cands = game.bld.buildingsData.filter(function (b) {
      if (!b.unlocked || A.EDIFICIOS_EXCLUIR.indexOf(b.name) >= 0) return false;
      var meta = game.bld.getBuildingExt(b.name).meta;
      if (meta.limitBuild && meta.val >= meta.limitBuild) return false;
      var p = game.bld.getPrices(b.name);
      return p.length && !game.resPool.isStorageLimited(p);
    });
    for (var i = 0; i < cands.length; i++) {
      var b = cands[i], p = game.bld.getPrices(b.name);
      var t = simular(M, [{ p: p }], null, null, A.EDIFICIOS_HORAS * 3600).t;
      if (isFinite(t)) lista.push({ name: b.name, label: etiqueta("buildings", b.name), t: t });
      if (i % 4 === 3) await esperar();
    }
    lista.sort(function (a, b) { return a.t - b.t; });
    return lista;
  }
  // elige el edificio que tarda menos, arma su plan y lo ejecuta
  async function siguienteEdificio() {
    calculando = true;
    try {
      var lista = await rankingEdificios();
      d.rankingEdificios = lista.slice(0, 5);
      if (!lista.length) { if (segundos - (d.avisoEdificios || -1e9) > 600) { anotar("Edificios: ninguno se alcanza en " + A.EDIFICIOS_HORAS + " h; reviso de nuevo en un rato"); d.avisoEdificios = segundos; } return; }
      var P = await calcularPlan("buildings", lista[0].name, { auto: true });
      if (!isFinite(P.sim.t)) return;
      d.plan = P; d.ejecutando = true; d.pausa = false; ultimoReparto = -999; empezarCronometro();
      anotar("Edificios: voy por " + P.label + " (" + tiempo(P.sim.t) + ")" + (lista[1] ? "; después " + lista[1].label + " (" + tiempo(lista[1].t) + ")" : ""));
      guardar();
    } finally { calculando = false; }
  }

  // =================== CALCULAR EL PLAN ===================
  // el mantenimiento (gatitos para los insumos, reserva, Oil Wells, slabs para los tratos) solo va en el modo edificios;
  // con una meta elegida por la usuaria, todos los gatitos van a la meta
  var enCalculo = null;
  function mantActivo() { return !!d.on.escasos && (enCalculo !== null ? enCalculo : (d.plan ? !!d.plan.auto : !!d.modoEdificios)); }
  async function calcularPlan(type, name, opts) {
    enCalculo = !!(opts && opts.auto);
    try { var P = await calcularPlan0(type, name); P.auto = enCalculo; return P; } finally { enCalculo = null; }
  }
  async function calcularPlan0(type, name) {
    RECETAS = {};
    var t0 = performance.now(), espera0 = 0;
    var M = medirSeguro();
    await esperar();
    var pMeta = precios(type, name);
    var alm = await planAlmacen(M, pMeta);
    // primero: edificios para que no se acabe lo que consumen tus edificios y no depende de gatitos (oil → Oil Wells)
    var sost = planSostener(M), nSost = sost.length; alm.pasos = sost.concat(alm.pasos);
    // titanium: lo que falta se consigue comerciando con las Zebras
    var stock0 = {}; game.resPool.resources.forEach(function (r) { stock0[r.name] = r.value; });
    var faltaTi = faltante(stock0, alm.pasos.map(function (s) { return s.p; }).concat([pMeta])).titanium || 0;
    var tratos = pasosComercio(faltaTi);
    var itemsAlm = alm.pasos.map(function (s) { return { p: s.p, cap: s.cap }; });
    var items = itemsAlm.concat(tratos.map(function (s) { return { p: s.p, gana: s.gana }; })).concat([{ p: pMeta }]);
    var base = simular(M, items, null, null), tAhora = tcomp(base);
    var tAhoraSinNada = tAhora; // para mostrar cuánto ahorran barcos y ayudas
    // ¿conviene fabricar barcos antes de comerciar?
    var barcos = await planBarcos(M, itemsAlm, tratos, pMeta, faltaTi, tAhora), pasoBarcos = [];
    if (barcos) {
      tratos = barcos.tratos; pasoBarcos = [barcos.paso]; tAhora = barcos.t;
      items = itemsAlm.concat([{ p: barcos.paso.p, gana: barcos.paso.gana }])
        .concat(tratos.map(function (s) { return { p: s.p, gana: s.gana }; })).concat([{ p: pMeta }]);
    }
    var ayudas = await planAyudas(M, items, tAhora);
    // mismo orden que la simulación: primero lo que sostiene la producción, las ayudas, almacenamiento, barcos, tratos y la meta
    var pasos = alm.pasos.slice(0, nSost).concat(ayudas).concat(alm.pasos.slice(nSost)).concat(pasoBarcos).concat(tratos).concat([{ type: type, name: name, p: pMeta, motivo: "meta" }]);
    // simulación final con todo
    var itemsF = items.slice(0, nSost).concat(ayudas.map(function (a) { return { p: a.p, M: a.M }; })).concat(items.slice(nSost));
    var fin = (ayudas.length || barcos || nSost) ? simular(M, itemsF) : base;
    // tiempos por recurso (con todos los libres en su mejor oficio)
    var stock = {}; game.resPool.resources.forEach(function (r) { stock[r.name] = r.value; });
    var falta = faltante(stock, pasos.map(function (p) { return p.type === "trade" ? p.reales : p.p; })), porRec = [];
    delete falta.titanium; // va por comercio
    Object.keys(falta).forEach(function (r) {
      var j = mejorJob(M, r), b = M.base[r] || 0, conJ = j ? b + M.m[j][r] * M.N : b, conv = null;
      if (!j) M.conv.forEach(function (c) { if (c.outs[r] > 0) { conv = c; conJ = b + c.outs[r]; } });
      porRec.push({ r: r, falta: falta[r], job: j, conv: conv ? etiqueta("buildings", conv.nombre) : null, t: conJ > 0 ? falta[r] / conJ : Infinity, solo: !j && !conv });
    });
    porRec.sort(function (a, b) { return b.t - a.t; });
    var z = zebras();
    return {
      type: type, name: name, label: etiqueta(type, name), pasos: pasos, M: M, sim: fin, sinAyuda: tAhoraSinNada,
      porRec: porRec, imposible: alm.imposible, ms: Math.round(performance.now() - t0),
      tratos: tratos.reduce(function (a, s) { return a + s.k; }, 0), faltaTi: faltaTi, zebras: z,
      sinZebras: faltaTi > 0 && !tratos.length
    };
  }

  // =================== EJECUCIÓN ===================
  function reservas() { // lo que el plan necesita (y los insumos de los edificios que consumen): nadie más debe gastarlo
    var o = colchones();
    if (!d.plan || !d.ejecutando) return o;
    var stock = {}; game.resPool.resources.forEach(function (r) { stock[r.name] = 0; });
    function reales(p) { return p.type === "trade" ? p.reales : p.p; }
    d.plan.pasos.forEach(function (p) { reales(p).forEach(function (x) { o[x.name] = (o[x.name] || 0) + x.val; }); });
    var bruto = faltante(stock, d.plan.pasos.map(reales));
    Object.keys(bruto).forEach(function (r) { o[r] = Math.max(o[r] || 0, bruto[r]); });
    return o;
  }
  function libre(n, res) { return R(n).value - ((res || {})[n] || 0); }
  function fabricar(nombre, max, res) {
    var c = game.workshop.getCraft(nombre); if (!c || !c.unlocked) return 0;
    var n = max;
    game.workshop.getCraftPrice(c).forEach(function (p) { n = Math.min(n, Math.floor(libre(p.name, res) / p.val)); });
    if (!isFinite(n) || n < 1) return 0;
    return craftear(nombre, n);
  }
  // fabrica en cadena hacia los precios del paso actual
  function fabricarHacia(p) {
    var reservaFab = colchones(); // tampoco fabrica gastando los insumos de Smelters, Magnetos, etc.
    p.forEach(function (y) { if (esFab(y.name)) reservaFab[y.name] = y.val; });
    function hacer(n, cant, nivel) {
      if (cant <= 0 || nivel > 6) return;
      var r = rec(n), veces = Math.ceil(cant / r.rinde);
      Object.keys(r.porVez).forEach(function (q) {
        if (!esFab(q)) return;
        var nec = r.porVez[q] * veces + (reservaFab[q] || 0) - R(q).value;
        if (nec > 0) hacer(q, nec, nivel + 1);
      });
      var posibles = veces;
      Object.keys(r.porVez).forEach(function (q) { posibles = Math.min(posibles, Math.floor((R(q).value - (reservaFab[q] || 0)) / r.porVez[q])); });
      if (posibles >= 1) craftear(n, posibles);
    }
    p.forEach(function (x) {
      if (!esFab(x.name)) return;
      var falta = x.val - R(x.name).value; if (falta <= 0) return;
      var guard = reservaFab[x.name]; reservaFab[x.name] = 0; hacer(x.name, falta, 0); reservaFab[x.name] = guard;
    });
  }
  function aplicarReparto() {
    if (!d.plan || !d.plan.pasos.length) return;
    var M = medirSeguro(); if (mantActivo()) ajustarMantenimiento(M); // mira cómo vienen los insumos con el reparto que había
    d.ritmoTratos = slabsParaTratos(M); // lo que se junta por segundo para los slabs de los tratos
    var stock = {}; game.resPool.resources.forEach(function (r) { stock[r.name] = r.value; });
    var a = politica(M, stock, [d.plan.pasos[0].p], d.jobActual); // en un trato, p incluye los furs que cuesta su catpower
    d.etapaActual = ultimaEtapa ? Object.assign({}, ultimaEtapa) : null; // para mostrar qué se está juntando
    d.jobActual = Object.keys(a)[0];
    var asig = asignar(M, a), kittens = game.village.sim.kittens, cambios = 0;
    function poner(k, job) {
      if (k.job === job) return;
      if (k.job) game.village.unassignJob(k);
      if (job) { k.job = job; game.village.getJob(job).value++; }
      cambios++;
    }
    M.fijos.forEach(function (i) { poner(kittens[i], "farmer"); });
    M.kit.forEach(function (g, n) { poner(kittens[g.idx], asig[n]); });
    if (cambios) {
      game.village.updateResourceProduction(); game.villageTab && game.villageTab.updateTab && game.villageTab.updateTab();
      var j = Object.keys(a)[0], mt = mantenimiento(M);
      anotar("Reparto: " + a[j] + " gatitos a " + (JT[j] || j) + (Object.keys(mt).length ? " + " + textoMant(mt) + " para mantener " + nombresConv(M) : "") + " (" + M.nFijos + " farmers fijos)");
    }
  }
  function pasoEjecutar() {
    if (!d.plan || !d.ejecutando || d.pausa) return;
    var p = d.plan.pasos[0];
    if (!p) {
      anotar((d.plan.auto ? "Edificios: listo " : "¡Meta cumplida: ") + d.plan.label + (d.plan.auto ? "" : "!"));
      registrarResultado();
      if (d.on.edificios) { d.modoEdificios = true; ultimaBusqueda = -999; } // sigue con el edificio que tarde menos
      d.ejecutando = false; d.plan = null; guardar(); return;
    }
    if (p.type === "trade") { comerciar(p); }
    else if (p.type === "ship") { // fabricar barcos por tandas, a medida que alcanza
      fabricarHacia(p.p);
      var cs = game.workshop.getCraft("ship"), n = p.veces;
      if (cs) game.workshop.getCraftPrice(cs).forEach(function (x) { n = Math.min(n, Math.floor(R(x.name).value / x.val)); });
      if (n >= 1 && craftear("ship", n)) {
        p.veces -= n; p.p = p.p.map(function (x) { return { name: x.name, val: x.val / (p.veces + n) * p.veces }; });
        anotar("Fabriqué barcos: ahora tienes " + Math.floor(R("ship").value));
        if (p.veces <= 0) { terminarPaso(); ultimoReparto = -999; guardar(); }
      }
    }
    else {
    if (p.motivo === "meta") { // si los tratos dieron menos titanium de lo esperado, agrega más
      var st0 = {}; game.resPool.resources.forEach(function (r) { st0[r.name] = r.value; });
      var fti = faltante(st0, [precios(p.type, p.name)]).titanium || 0, extra = fti > 0 ? pasosComercio(fti) : [];
      if (extra.length) { d.plan.pasos = extra.concat(d.plan.pasos); anotar("Faltan " + num(fti) + " de titanium: agrego " + extra.reduce(function (a, s) { return a + s.k; }, 0) + " tratos con las Zebras"); return; }
    }
    p.p = precios(p.type, p.name); // precio actualizado
    fabricarHacia(p.p);
    var col = colchones(); // no deja sin insumos a Smelters, Magnetos, etc.
    if (p.p.every(function (x) { return R(x.name).value >= x.val + colPara(col, x, R(x.name).maxValue || Infinity); })) {
      if (comprar(p.type, p.name)) {
        anotar("Compré " + etiqueta(p.type, p.name) + (p.motivo !== "meta" ? " (" + p.motivo + ")" : ""));
        terminarPaso(); ultimoReparto = -999; guardar();
      }
    }
    }
    if (segundos - ultimoReparto >= A.REPLANEAR_SEG) { ultimoReparto = segundos; aplicarReparto(); }
  }

  // ---------- pasos: hechos, actual y su avance ----------
  function textoPaso(p) {
    if (p.type === "trade") return "Comerciar " + p.k + " veces con las Zebras <span style='color:#9aa3b2'>(~" + num(p.gana.titanium) + " titanium)</span>";
    if (p.type === "ship") {
      var rinde = (rec("ship") || { rinde: 1 }).rinde, zb = zebras(p.veces * rinde);
      return "Fabricar ~" + Math.round(p.veces * rinde) + " barcos <span style='color:#7fd19b'>(ahorra " + textoAhorro(p.ahorro || 0) + ")</span>" +
        (zb ? " <span style='color:#9aa3b2'>→ ~" + num(zb.ti) + " titanium por trato</span>" : "");
    }
    return (p.motivo === "meta" ? "<b>" + etiqueta(p.type, p.name) + "</b>" : "Construir " + etiqueta(p.type, p.name)) +
      (p.motivo === "almacenamiento" ? " <span style='color:#e0b050'>(falta tope)</span>" : "") +
      (p.motivo === "sostener" ? " <span style='color:#e0b050'>(para no quedarte sin " + titulo(p.recurso) + ")</span>" : "") +
      (p.motivo === "adelanta la meta" ? " <span style='color:#7fd19b'>(ahorra " + textoAhorro(p.ahorro) + ")</span>" : "");
  }
  function terminarPaso() {
    var p = d.plan.pasos.shift(); if (!p) return;
    (d.plan.hechos = d.plan.hechos || []).push({ texto: textoPaso(p).replace(/<[^>]+>/g, ""), t: Date.now() });
    d.jobActual = null; d.etapaActual = null; d.reestimar = true; // la etapa siguiente se elige de cero
  }
  // cuánto tienes de lo que pide un paso (los fabricados se cuentan en materias primas)
  function avancePaso(p) {
    var pr = p.type === "trade" ? p.reales : p.p; if (!pr || !pr.length) return [];
    var stock = {}; game.resPool.resources.forEach(function (r) { stock[r.name] = r.value; });
    var tot = faltante({}, [pr]), fal = faltante(sinCol(stock, colchones()), [pr]);
    return Object.keys(tot).map(function (r) { return { r: r, pct: Math.max(0, Math.min(1, 1 - (fal[r] || 0) / tot[r])), falta: fal[r] || 0 }; })
      .sort(function (a, b) { return a.pct - b.pct; });
  }
  function barra(pct) {
    return "<span style='display:inline-block;width:80px;height:7px;background:#2a2f3a;border-radius:4px;vertical-align:middle;margin-right:4px'>" +
      "<span style='display:block;height:7px;width:" + Math.round(pct * 100) + "%;background:#7fd19b;border-radius:4px'></span></span>";
  }
  function htmlPasos(P) {
    var h = "<div><b>Pasos:</b><ul style='margin:2px 0 6px 0;padding:0;list-style:none'>";
    (P.hechos || []).slice(-4).forEach(function (x) { h += "<li style='color:#7fd19b'>✓ " + x.texto + " <span style='color:#9aa3b2'>(" + hora(x.t) + ")</span></li>"; });
    var et = P.sim.etapas || [];
    P.pasos.forEach(function (p, i) {
      var actual = i === 0 && d.ejecutando;
      h += "<li style='margin-top:3px" + (actual ? ";color:#fff" : "") + "'>" + (actual ? "▶ " : (i + 1) + ". ") + textoPaso(p);
      // etapas de este paso en la simulación: un recurso a la vez
      var mias = et.filter(function (e) { return e.paso === i; });
      if (mias.length) h += "<div style='color:#9aa3b2;font-size:11.5px;margin-left:14px'>" + mias.slice(0, 5).map(function (e) {
        var sig = et[et.indexOf(e) + 1], fin = sig ? sig.desde : P.sim.t;
        return (JT[e.job] || e.job) + (e.recurso ? " (" + titulo(e.recurso) + ")" : "") + " " + tiempo(e.desde).replace("ya", "0 min") + "–" + tiempo(fin);
      }).join(" → ") + (mias.length > 5 ? " → …" : "") + "</div>";
      if (actual) {
        var av = avancePaso(p), tot = av.length ? av.reduce(function (s, x) { return s + x.pct; }, 0) / av.length : 1, ea = d.etapaActual;
        h += "<div style='font-size:11.5px;margin-left:14px'>" + barra(tot) + Math.round(tot * 100) + " %" +
          (p.type === "trade" ? " · faltan " + p.k + " tratos" : p.type === "ship" ? " · faltan " + p.veces + " fabricaciones" : "") + "</div>";
        if (ea && ea.job) h += "<div style='font-size:11.5px;margin-left:14px;color:#c8cdd6'>Ahora: todos a <b>" + (JT[ea.job] || ea.job) + "</b>" +
          (ea.recurso ? " juntando " + titulo(ea.recurso) : "") + "</div>";
        if (av.length) h += "<div style='font-size:11.5px;margin-left:14px;color:#9aa3b2'>" + av.slice(0, 5).map(function (x) {
          return titulo(x.r) + " " + Math.round(x.pct * 100) + " %" + (x.falta > 0 ? " (faltan " + num(x.falta) + ")" : "");
        }).join(" · ") + "</div>";
      }
      h += "</li>";
    });
    return h + "</ul></div>";
  }

  // ---------- estimado vs real ----------
  function empezarCronometro() {
    if (!d.plan) return;
    d.plan.inicio = Date.now(); d.plan.estimado = tcomp(d.plan.sim); d.plan.pausado = 0; d.plan.pausaDesde = null;
  }
  function cronometroPausa() {
    var P = d.plan; if (!P || !P.inicio) return;
    if (d.pausa) P.pausaDesde = Date.now();
    else if (P.pausaDesde) { P.pausado = (P.pausado || 0) + (Date.now() - P.pausaDesde); P.pausaDesde = null; }
  }
  function registrarResultado() {
    var P = d.plan; if (!P || !P.inicio || !isFinite(P.estimado)) return;
    var real = (Date.now() - P.inicio - (P.pausado || 0)) / 1000;
    if (real < 30) return; // demasiado corto para comparar
    d.historial.unshift({ label: P.label, est: P.estimado, real: real, fecha: Date.now() });
    d.historial.length = Math.min(d.historial.length, 10);
    anotar("Estimado " + tiempo(P.estimado) + ", real " + tiempo(real) + " (" + (real >= P.estimado ? "+" : "") + Math.round((real / Math.max(1, P.estimado) - 1) * 100) + " %)");
  }
  // cuánto más (o menos) tardaron de verdad las últimas metas: real / estimado
  function factorHistorial() {
    var h = d.historial.filter(function (x) { return x.est > 60 && isFinite(x.est); }).slice(0, 5);
    if (h.length < 2) return null;
    return { f: h.reduce(function (s, x) { return s + x.real / x.est; }, 0) / h.length, n: h.length };
  }
  // vuelve a simular lo que queda del plan con la producción de ahora (p. ej. tras una compra de oportunidad)
  function reestimar() {
    var P = d.plan; if (!P || !P.pasos.length) return;
    var items = P.pasos.map(function (p) {
      if (p.type === "trade") return { p: p.p, gana: p.gana };
      return { p: p.p, cap: p.cap, gana: p.gana, M: p.M };
    });
    P.sim = simular(medirSeguro(), items);
    P.reestimadoEn = Date.now();
  }

  function comerciar(p) {
    var z = zebras(); if (!z) return;
    fabricarHacia(p.reales); // slabs
    var dip = game.diplomacy, max = dip.getMaxTradeAmt(z.race) || 0, n = Math.min(p.k, max);
    if (n < 1) return;
    var antes = R("titanium").value;
    dip.tradeMultiple(z.race, n);
    p.k -= n; sumar("tratos", n); sumar("titanium", R("titanium").value - antes);
    anotar("Comercié " + n + " veces con las Zebras: +" + num(R("titanium").value - antes) + " titanium");
    if (p.k <= 0) { terminarPaso(); ultimoReparto = -999; guardar(); }
  }

  // =================== AUTOMÁTICOS ===================
  // lleno: también cuenta lo que los conversores (Smelters, Calciners…) se comen cada segundo,
  // porque un recurso que se consume nunca llega justo al 100 % (idea de Kitten Scientists)
  function lleno(n, pct) {
    var r = R(n); if (!(r.maxValue > 0)) return false;
    var consumo = -Math.min(0, game.getEffect(n + "PerTickCon") || 0) * tps() * 2;
    return r.value >= Math.min(r.maxValue * pct, r.maxValue - consumo);
  }
  function automaticos() {
    var res = reservas(), necesitaCaza = !!(res.furs || res.ivory || res.parchment || res.manuscript || res.compedium);
    var resF = Object.assign({}, res); resF.furs = (res.furs || 0) + A.RESERVA_FURS; // furs: siempre deja una reserva
    if (d.on.cielo && game.calendar.observeBtn) { var b = document.querySelector("#observeButton input"); if (b) b.click(); else game.calendar.observeHandler(); sumar("cielo", 1); }
    if (d.on.refinar && lleno("catnip", 0.99)) {
      var w = R("wood"), rinde = 1 + game.getResCraftRatio("wood");
      fabricar("wood", w.maxValue ? Math.floor((w.maxValue - w.value) / rinde) : 100);
    }
    var fest = d.on.festival ? festivalQuiere(res) : null;
    if (fest && fest.listo) festival(resF);
    var pasoTrato = d.ejecutando && d.plan && d.plan.pasos[0] && d.plan.pasos[0].type === "trade";
    if (d.on.oroTitanio && mantActivo() && d.ritmoTratos) { // la cuenta aparte crece con lo que juntan los miners extra (hasta 1 h)
      d.cuentaTratos = d.cuentaTratos || {};
      Object.keys(d.ritmoTratos).forEach(function (q) { d.cuentaTratos[q] = Math.min(d.ritmoTratos[q] * 3600, (d.cuentaTratos[q] || 0) + d.ritmoTratos[q]); });
    }
    if (d.on.oroTitanio && !pasoTrato) oroATitanio(res); // antes de cazar, para que quede catpower
    if (d.on.cazar && (lleno("manpower", 0.99) || (necesitaCaza && d.ejecutando))) {
      var reservaCaza = A.RESERVA_CAZA + (pasoTrato ? (zebras() || { catpower: 50 }).catpower * Math.min(d.plan.pasos[0].k, 50) : 0);
      if (fest) reservaCaza = Math.max(reservaCaza, FESTIVAL.manpower); // guarda el catpower del festival
      var zt = d.on.oroTitanio ? zebras() : null, gt = R("gold");
      if (zt && gt.maxValue && gt.value >= gt.maxValue * 0.9) reservaCaza = Math.max(reservaCaza, A.RESERVA_CAZA + 20 * zt.catpower + ((res || {}).manpower || 0)); // catpower para los tratos gold → titanium
      var cz = caza(), grupos = Math.floor((R("manpower").value - reservaCaza) / cz.costo);
      if (grupos >= 1) {
        var f0 = R("furs").value, i0 = R("ivory").value;
        game.resPool.addResEvent("manpower", -grupos * cz.costo); game.village.gainHuntRes(grupos);
        sumar("cazas", grupos); sumar("furs", R("furs").value - f0); sumar("ivory", R("ivory").value - i0);
      }
    }
    // si toca festival, la culture se junta para él (los manuscripts esperan)
    if (d.on.manuscript && lleno("culture", A.CULTURA_PCT) && !fest) manuscriptsConCultura(resF);
    if (d.on.oportunidad && segundos % 10 === 0) oportunidad(res);
    if (d.on.escasos && segundos % 10 === 3) encenderConsumidores();
    if (d.on.steel && segundos % A.STEEL_CADA_SEG === 0) fabricar("steel", Infinity, res);
    if (d.on.bsp) {
      if (lleno("wood", 0.98)) fabricar("beam", 1, res);
      if (lleno("minerals", 0.98)) fabricar("slab", 1, res);
      if (lleno("iron", 0.995)) fabricar("plate", 1, res);
    }
    if (d.on.fe) fe(res);
    if (d.on.unicornios && segundos - ultimoUnicornio >= 15) { ultimoUnicornio = segundos; unicornios(res); }
  }
  // asegura cierta cantidad de parchment, fabricándolo con furs si hace falta (res incluye la reserva de furs)
  function parchmentHasta(cant, res) {
    var falta = cant - R("parchment").value; if (falta <= 0) return true;
    var rindeP = 1 + game.getResCraftRatio("parchment");
    fabricar("parchment", Math.ceil(falta / rindeP), res);
    return R("parchment").value >= cant;
  }
  function parchmentPosible(res) {
    var rp = game.workshop.getCraft("parchment"), posible = R("parchment").value, rindeP = 1 + game.getResCraftRatio("parchment"), veces = Infinity;
    if (!rp || !rp.unlocked) return posible;
    game.workshop.getCraftPrice(rp).forEach(function (p) { veces = Math.min(veces, Math.floor(libre(p.name, res) / p.val)); });
    return posible + Math.max(0, isFinite(veces) ? veces : 0) * rindeP;
  }
  // gasta la culture en manuscripts (el parchment sale de los furs, dejando la reserva)
  function manuscriptsConCultura(res) {
    var rm = game.workshop.getCraft("manuscript"); if (!rm || !rm.unlocked) return;
    var pm = game.workshop.getCraftPrice(rm), veces = Infinity, parchPorVez = 0;
    pm.forEach(function (p) { if (p.name === "parchment") parchPorVez = p.val; else veces = Math.min(veces, Math.floor(libre(p.name, res) / p.val)); });
    if (parchPorVez > 0) veces = Math.min(veces, Math.floor(parchmentPosible(res) / parchPorVez));
    if (!isFinite(veces) || veces < 1) return;
    parchmentHasta(veces * parchPorVez, res);
    fabricar("manuscript", veces);
  }

  // ---------- festivales (desde Drama) ----------
  var FESTIVAL = { manpower: 1500, culture: 5000, parchment: 2500 }, festivalCache = null;
  // cuánto sube la producción con un festival, medido con el juego
  function efectoFestival() {
    if (festivalCache && segundos - festivalCache.seg < 60) return festivalCache.v;
    var cal = game.calendar, d0 = cal.festivalDays, sin, con;
    try { cal.festivalDays = 0; sin = prodActual(); cal.festivalDays = 400; con = prodActual(); }
    finally { cal.festivalDays = d0; game.village.updateHappines(); game.village.updateResourceProduction(); }
    var v = {};
    Object.keys(con).forEach(function (r) { if ((sin[r] || 0) > 1e-6 && con[r] > sin[r] * 1.001) v[r] = con[r] / sin[r] - 1; });
    festivalCache = { seg: segundos, v: v };
    return v;
  }
  function festivalDisponible() {
    if (!game.science.get("drama").researched) return false;
    var carnavales = game.prestige && game.prestige.getPerk("carnivals") && game.prestige.getPerk("carnivals").researched;
    return carnavales ? game.calendar.festivalDays <= 400 : game.calendar.festivalDays <= 0;
  }
  // devuelve null si no toca festival; si toca, {listo: hay todo lo necesario}
  function festivalQuiere(res) {
    if (!festivalDisponible()) return null;
    var c = R("culture"); if (c.maxValue && c.maxValue - (res.culture || 0) < FESTIVAL.culture) return null; // no cabe con lo que reserva el plan
    var ef = efectoFestival(); if (!Object.keys(ef).some(function (r) { return ef[r] >= 0.05; })) return null; // sube menos del 5 %: no vale la pena
    var resF = Object.assign({}, res); resF.furs = (res.furs || 0) + A.RESERVA_FURS;
    var parchOk = libre("parchment", res) >= FESTIVAL.parchment || parchmentPosible(resF) - (res.parchment || 0) >= FESTIVAL.parchment;
    if (!parchOk) return null; // sin parchment (o furs) suficiente, ni lo espera: los manuscripts siguen
    var listo = libre("manpower", res) >= FESTIVAL.manpower && libre("culture", res) >= FESTIVAL.culture;
    return { listo: listo };
  }
  function festival(resF) {
    if (!parchmentHasta(FESTIVAL.parchment + (resF.parchment || 0), resF)) return;
    var pr = Object.keys(FESTIVAL).map(function (k) { return { name: k, val: FESTIVAL[k] }; });
    if (!pr.every(function (x) { return R(x.name).value >= x.val; })) return;
    game.resPool.payPrices(pr);
    game.village.holdFestival(1);
    sumar("festivales", 1);
    var ef = efectoFestival(), top = Object.keys(ef).sort(function (a, b) { return ef[b] - ef[a]; }).slice(0, 3);
    anotar("Festival: " + top.map(function (r) { return titulo(r) + " +" + Math.round(ef[r] * 100) + " %"; }).join(", ") + " por " + game.calendar.festivalDays + " días");
  }

  // ---------- gold lleno: el sobrante se cambia por titanium (así el gold no se pierde en el tope) ----------
  function oroATitanio(res) {
    var g = R("gold"), ti = R("titanium"), z = zebras();
    if (!z || !g.maxValue || g.value < g.maxValue * A.ORO_TRATOS_PCT) return;
    if (ti.maxValue && ti.value >= ti.maxValue * 0.98) return; // el titanium también está lleno
    var n = Math.floor((g.value - Math.max(g.maxValue * A.ORO_DEJAR_PCT, res.gold || 0)) / z.gold);
    // si faltan slabs (lo que piden las Zebras), los fabrica con su "cuenta aparte": lo que juntan los miners extra
    // de mantenimiento para los tratos (el plan no los puede reservar); y si el plan no los necesita, con lo que sobre
    var faltaS = n * z.compraVal - libre(z.compra, res), rc = rec(z.compra);
    if (faltaS > 0 && rc) {
      var resS = Object.assign({}, res), col0 = colchones(), antes = {};
      Object.keys(rc.porVez).forEach(function (q) {
        antes[q] = R(q).value;
        var usable = Math.max(0, Math.min((d.cuentaTratos || {})[q] || 0, R(q).value - (col0[q] || 0))); // la cuenta, sin tocar la reserva de insumos
        resS[q] = Math.min(res[q] || 0, R(q).value - usable);
      });
      fabricar(z.compra, Math.ceil(faltaS / rc.rinde), resS);
      Object.keys(antes).forEach(function (q) { if (d.cuentaTratos && d.cuentaTratos[q]) d.cuentaTratos[q] = Math.max(0, d.cuentaTratos[q] - (antes[q] - R(q).value)); });
    }
    n = Math.min(n, Math.floor(libre(z.compra, res) / z.compraVal), Math.floor((libre("manpower", res) - A.RESERVA_CAZA) / z.catpower),
      game.diplomacy.getMaxTradeAmt(z.race) || 0);
    if (!(n >= 1)) return;
    var t0 = ti.value;
    game.diplomacy.tradeMultiple(z.race, n);
    sumar("tratos", n); sumar("titanium", ti.value - t0);
    anotar("Gold casi lleno: " + n + " tratos con las Zebras → +" + num(ti.value - t0) + " titanium");
  }

  // ---------- compras de oportunidad: mejoras del workshop con lo que sobra ----------
  // Solo con lo que el plan no reserva, y solo si el recurso está casi lleno (se perdería)
  // o si el precio es poco comparado con lo que tienes.
  function oportunidad(res) {
    var meta = d.plan ? d.plan.type + "|" + d.plan.name : "";
    var cands = game.workshop.upgrades.filter(function (u) { return u.unlocked && !u.researched && "upgrades|" + u.name !== meta; });
    for (var i = 0; i < cands.length; i++) {
      var u = cands[i], pr = precios("upgrades", u.name); if (!pr.length) continue;
      var ok = pr.every(function (x) {
        var r = R(x.name), l = libre(x.name, res); if (l < x.val) return false;
        if (r.maxValue > 0) return lleno(x.name, A.OPORTUNIDAD_PCT) || x.val <= l * 0.1;
        return x.val <= l * 0.5;
      });
      if (ok && comprar("upgrades", u.name)) { sumar("oportunidad", 1); anotar("Oportunidad: compré " + u.label + " con lo que sobraba"); d.reestimar = true; return; }
    }
  }

  // ---------- fe ----------
  function fe(res) {
    var f = R("faith"); if (!f.maxValue || f.value < f.maxValue * 0.98) return;
    var pend = game.religion.religionUpgrades.filter(function (u) { return !u.on && game.religion.faith >= (u.faith || 0); });
    pend.sort(function (a, b) { return (a.prices[0] || {}).val - (b.prices[0] || {}).val; });
    var cand = pend[0];
    if (cand) {
      var pr = precios("religion", cand.name);
      var feP = (pr.filter(function (x) { return x.name === "faith"; })[0] || {}).val || 0;
      var puede = pr.every(function (x) { return libre(x.name, x.name === "faith" ? {} : res) >= x.val; });
      if (puede && comprar("religion", cand.name)) { anotar("Fe: compré " + cand.label); return; }
      var soloFe = pr.every(function (x) { return x.name === "faith" || libre(x.name, res) >= x.val; });
      if (feP <= f.maxValue && soloFe) return; // espera a juntar la fe
    }
    game.religion.praise(); sumar("praise", 1); anotar("Fe: Praise the sun (" + num(f.value) + ")");
  }

  // ---------- unicornios: pasture vs mejoras del ziggurat (sacrificando) ----------
  function unicorniosPorSeg() { return (game.calcResourcePerTick("unicorns") + game.getResourcePerTickConvertion("unicorns")) * tps(); }
  function opcionesUnicornio(res) {
    var zig = game.bld.get("ziggurat").on || 0, base = unicorniosPorSeg(), ops = [];
    var pp = game.bld.get("unicornPasture");
    if (pp && pp.unlocked) {
      var d1 = conEdificio("unicornPasture", function () { return unicorniosPorSeg() - base; });
      var pr = game.bld.getPrices("unicornPasture"), costo = (pr.filter(function (x) { return x.name === "unicorns"; })[0] || {}).val || 0;
      ops.push({ type: "buildings", name: "unicornPasture", label: etiqueta("buildings", "unicornPasture"), ganancia: d1, costoU: costo, otros: pr.filter(function (x) { return x.name !== "unicorns"; }) });
    }
    if (zig > 0) game.religion.zigguratUpgrades.forEach(function (z) {
      if (!z.unlocked || !(z.effects && "unicornsRatioReligion" in z.effects)) return;
      var pr = precios("zigguratUpgrades", z.name); if (!pr.length) return;
      var lagr = (pr.filter(function (x) { return x.name === "tears"; })[0] || {}).val || 0;
      var faltaL = Math.max(0, lagr - R("tears").value), sacr = Math.ceil(faltaL / zig);
      var d2 = 0, v0 = z.val, o0 = z.on;
      try { z.val = v0 + 1; z.on = o0 + 1; if (z.calculateEffects) z.calculateEffects(z, game); game.updateCaches(); d2 = unicorniosPorSeg() - base; }
      finally { z.val = v0; z.on = o0; if (z.calculateEffects) z.calculateEffects(z, game); game.updateCaches(); }
      ops.push({ type: "zigguratUpgrades", name: z.name, label: z.label, ganancia: d2, costoU: sacr * 2500, sacr: sacr, otros: pr.filter(function (x) { return x.name !== "tears"; }) });
    });
    ops.forEach(function (o) {
      o.recupera = o.ganancia > 0 ? o.costoU / o.ganancia : Infinity;
      o.otrosOk = o.otros.every(function (x) { return libre(x.name, res) >= x.val; });
    });
    ops.sort(function (a, b) { return a.recupera - b.recupera; });
    return ops;
  }
  function unicornios(res) {
    var ops; try { ops = opcionesUnicornio(res); } catch (e) { console.error(e); return; }
    var zig = game.bld.get("ziggurat").on || 0;
    var mejor = ops.filter(function (o) { return isFinite(o.recupera) && o.otrosOk; })[0];
    if (!mejor) { infoUnicornio = ops.length ? "Ninguna opción alcanza todavía (falta " + ops.map(function (o) { return o.label; }).join(", ") + ")" : ""; return; }
    infoUnicornio = "Mejor: " + mejor.label + " — se paga en " + tiempo(mejor.recupera) + (mejor.sacr ? " (sacrifica " + num(mejor.costoU) + " unicorns)" : "") +
      (ops[1] ? " · después: " + ops[1].label + " (" + tiempo(ops[1].recupera) + ")" : "") +
      (zig ? " · con 1 Ziggurat más, cada tear costaría " + Math.round(2500 / (zig + 1)) + " unicorns en vez de " + Math.round(2500 / zig) : "");
    var disponibles = libre("unicorns", res);
    if (disponibles < mejor.costoU) return;
    if (mejor.type === "zigguratUpgrades") {
      if (mejor.sacr > 0) { game.religion.sacrificeUnicornsToTarget(mejor.sacr * zig); anotar("Unicornios: sacrifiqué " + num(mejor.sacr * 2500) + " por tears"); }
    }
    if (comprar(mejor.type, mejor.name)) { anotar("Unicornios: compré " + mejor.label); d.reestimar = true; }
  }

  // =================== PANEL ===================
  var caja = document.createElement("div");
  caja.style.cssText = "position:fixed;right:12px;top:50px;z-index:99999;background:#14161c;color:#e6e6e6;border:1px solid #3a3f4b;border-radius:8px;" +
    "padding:10px;font:12.5px/1.5 system-ui,sans-serif;width:min(440px,95vw);max-height:86vh;overflow:auto;box-shadow:0 8px 24px #0008";
  document.body.appendChild(caja);
  var est = "background:#0e1014;color:#e6e6e6;border:1px solid #3a3f4b;border-radius:4px;padding:2px 6px;cursor:pointer";
  function opcionesMeta() {
    var g = [];
    var techs = game.science.techs.filter(function (t) { return t.unlocked && !t.researched; });
    var ups = game.workshop.upgrades.filter(function (u) { return u.unlocked && !u.researched; });
    var blds = game.bld.buildingsData.filter(function (b) { return b.unlocked; });
    function grupo(nombre, lista, type) {
      if (!lista.length) return "";
      return '<optgroup label="' + nombre + '">' + lista.map(function (x) {
        var v = type + "|" + x.name, sel = d.plan && (d.plan.type + "|" + d.plan.name) === v ? " selected" : "";
        return '<option value="' + v + '"' + sel + ">" + (type === "buildings" ? etiqueta(type, x.name) + " (" + x.val + ")" : x.label) + "</option>";
      }).join("") + "</optgroup>";
    }
    return grupo("Investigaciones", techs, "tech") + grupo("Mejoras del workshop", ups, "upgrades") + grupo("Edificios", blds, "buildings");
  }
  var FUN = [["cielo", "Observe the sky"], ["refinar", "Refinar catnip lleno"], ["cazar", "Cazar"], ["manuscript", "Manuscripts (culture " + Math.round(A.CULTURA_PCT * 100) + "%)"],
    ["steel", "Steel cada " + A.STEEL_CADA_SEG + " s"], ["bsp", "Beam/slab/plate al llenarse"], ["fe", "Gastar la fe"], ["unicornios", "Invertir unicorns"],
    ["festival", "Festivales (desde Drama)"], ["oportunidad", "Compras de oportunidad (mejoras del workshop con lo que sobra)"],
    ["escasos", "En el modo edificios: mantener andando los que consumen (Smelters, Calciner, Mints, Magnetos…): gatitos para sus insumos, reserva de " + Math.round(A.COLCHON_SEG / 60) + " min de consumo, Oil Wells si baja el oil y slabs para los tratos"],
    ["oroTitanio", "Gold casi lleno → cambiar el sobrante por titanium con las Zebras"],
    ["edificios", "Al terminar la meta, seguir comprando edificios (el que tarde menos, sin frenar Smelters, Calciner, Mints ni Magnetos)"]];
  function nombresConv(M) { return M.conv.map(function (c) { return etiqueta("buildings", c.nombre); }).join(", ") || "los conversores"; }
  function textoMant(mt) { return Object.keys(mt).map(function (j) { return mt[j] + " " + (JT[j] || j); }).join(" y "); }
  var vista = "";
  // resumen: totales desde que se pegó el script (o desde "Reiniciar")
  var NOMBRES_TOT = [["cazas", "cazas"], ["furs", "furs"], ["ivory", "ivory"], ["parchment", "parchment"], ["manuscript", "manuscripts"], ["compedium", "compendiums"],
    ["steel", "steel"], ["beam", "beams"], ["slab", "slabs"], ["plate", "plates"], ["ship", "barcos"], ["tratos", "tratos"], ["titanium", "titanium (comercio)"],
    ["compras", "compras"], ["oportunidad", "de oportunidad"], ["festivales", "festivales"], ["praise", "Praise the sun"], ["cielo", "Observe the sky"]];
  function infoResumen() {
    var t = d.tot, partes = NOMBRES_TOT.filter(function (x) { return t[x[0]] > 0; }).map(function (x) { return "<b>" + num(t[x[0]]) + "</b> " + x[1]; });
    var hace = (Date.now() - d.totDesde) / 1000;
    return "Hace " + tiempo(hace).replace("ya", "un momento") + ": " + (partes.join(" · ") || "todavía nada") +
      " <button data-a='resumen0' style='" + est + ";font-size:11px'>Reiniciar</button>";
  }
  function infoDatos() {
    var h = [], L = game.village.leader;
    if (L && L.trait && L.trait.name !== "none") {
      var tn = L.trait.name, txt = (L.trait.title || tn) + " (rango " + (L.rank || 0) + ")";
      try {
        if (tn === "scientist") txt += ": investigaciones al " + Math.round(game.village.getEffectLeader(tn, [{ name: "science", val: 10000 }])[0].val / 100) + " % del precio";
        else if (tn === "wise") txt += ": fe al " + Math.round(game.village.getEffectLeader(tn, [{ name: "faith", val: 10000 }])[0].val / 100) + " % del precio";
        else txt += ": +" + Math.round(game.village.getEffectLeader(tn, 0) * 100) + " %";
      } catch (e) {}
      if (game.village.getLeaderBonus) txt += " · produce ×" + game.village.getLeaderBonus(L.rank || 0).toFixed(2) + " en su oficio";
      h.push("Líder: " + txt);
    }
    try {
      var pob = (game.bld.buildingGroups || []).filter(function (g) { return g.name === "population"; })[0];
      if (pob) h.push("Casas antes del tope: " + pob.buildings.filter(function (n) { return game.bld.get(n).unlocked; }).map(function (n) {
        for (var k = 0; k <= 9; k++) if (game.resPool.isStorageLimited(game.bld.getPrices(n, k))) break;
        return etiqueta("buildings", n) + " " + (k > 9 ? "9+" : k);
      }).join(" · "));
    } catch (e) {}
    var z = zebras();
    if (z) h.push("Zebras: éxito " + Math.round(z.exito * 100) + " % · titanium " + Math.round(z.prob * 100) + " % de las veces, " + num(z.porTi) + " cada vez (~" + num(z.ti) + " por trato)");
    var cz = caza(); h.push("Caza: " + Math.round(cz.furs) + " furs y " + Math.round(cz.ivory) + " ivory por caza en promedio (bono " + cz.bono.toFixed(1) + ")");
    try {
      if (game.science.get("drama").researched) {
        var ef = efectoFestival(), top = Object.keys(ef).sort(function (a, b) { return ef[b] - ef[a]; }).slice(0, 4);
        h.push("Festival: " + (game.calendar.festivalDays > 0 ? "en curso, quedan " + game.calendar.festivalDays + " días. " : "") +
          (top.length ? "sube " + top.map(function (r) { return titulo(r) + " +" + Math.round(ef[r] * 100) + " %"; }).join(", ") : "no sube nada medible"));
      }
    } catch (e) {}
    try {
      var go = R("gold"), gs = (game.getResourcePerTick("gold", true) || 0) * tps();
      h.push("Gold: " + num(go.value) + " / " + num(go.maxValue) + ", " + (gs >= 0 ? "+" : "") + gs.toFixed(2) + "/s" +
        (gs > 0 && go.value < go.maxValue ? " → lleno en " + tiempo((go.maxValue - go.value) / gs) : ""));
    } catch (e) {}
    if (d.historial.length) {
      var fh = factorHistorial();
      h.push("Estimado vs real" + (fh ? " (últimas " + fh.n + " metas: tardaron " + (fh.f >= 1 ? Math.round((fh.f - 1) * 100) + " % más" : Math.round((1 - fh.f) * 100) + " % menos") + " de lo estimado)" : "") + ": " +
        d.historial.slice(0, 3).map(function (x) { return x.label + " " + tiempo(x.est) + " → " + tiempo(x.real); }).join(" · "));
    }
    h.push("Velocidad del juego: " + tps().toFixed(1) + " ticks/s");
    return h.join("<br>");
  }
  function pintarPlan() {
    if (calculando) return '<div style="color:#e0b050">Calculando… (el juego sigue andando)</div>';
    var P = d.plan, rk = (d.rankingEdificios || []).map(function (x) { return x.label + " " + tiempo(x.t); }).join(" · ");
    if (!P) {
      if (d.modoEdificios && d.on.edificios) return "<div style='color:#7fd19b'>Modo edificios: buscando el que tarde menos…</div>" +
        (rk ? "<div style='color:#9aa3b2;font-size:11.5px'>Últimos candidatos: " + rk + "</div>" : "");
      return '<div style="color:#9aa3b2">Elige una meta y presiona Calcular.</div>' +
        "<div style='margin-top:4px'><button data-a='edificios' style='" + est + "'>Solo comprar edificios</button></div>";
    }
    var h = (P.auto ? "<div style='color:#7fd19b;font-size:11.5px'>Modo edificios: el que tarda menos" + (rk ? "<br><span style='color:#9aa3b2'>Candidatos: " + rk + "</span>" : "") + "</div>" : "") +
      "<div style='margin:6px 0'><b>Meta:</b> " + P.label + " — <b>" + tiempoPlan(P.sim) + "</b>" + textoCorregido(P.sim) +
      (Math.abs(tcomp(P.sim) - P.sinAyuda) > 1 ? " <span style='color:#9aa3b2'>(sin los edificios sugeridos: " + (isFinite(P.sinAyuda) ? (P.sinAyuda > A.HORAS_MAX * 3600 ? "unas " : "") + tiempo(P.sinAyuda) : "nunca a ese ritmo") + ")</span>" : "") + "</div>";
    if (!isFinite(P.sim.t) && P.sim.avance) { // no alcanza en el límite: hasta dónde llega
      h += "<div style='color:#e0b050'>En " + textoLimite() + " llegarías a:<ul style='margin:2px 0 6px 18px;padding:0'>" + P.sim.avance.slice(0, 5).map(function (x) {
        return "<li>" + titulo(x.r) + ": " + Math.round(x.pct * 100) + " % (faltan " + num(x.falta) + ", " +
          (x.noCabe ? "no cabe en tu almacenamiento" : x.porSeg > 1e-9 ? "+" + num(x.porSeg) + "/s → " + tiempo(x.t) + " más" : "no se produce") + ")</li>";
      }).join("") + "</ul></div>";
    }
    if (P.imposible) h += "<div style='color:#e57373'>No encontré cómo subir el tope de: " + Object.keys(P.imposible).map(titulo).join(", ") + ".</div>";
    if (P.sinZebras) h += "<div style='color:#e57373'>Faltan " + num(P.faltaTi) + " de titanium y no puedes comerciar con las Zebras todavía (necesitas al menos 1 barco).</div>";
    if (P.tratos && P.zebras) h += "<div style='color:#9aa3b2;font-size:11.5px'>Zebras: éxito " + Math.round(P.zebras.exito * 100) + " %, titanium en el " + Math.round(P.zebras.prob * 100) + " % de los tratos, " + num(P.zebras.porTi) +
      " cada vez → ~" + num(P.zebras.ti) + " por trato en promedio. Si sale menos, agrega tratos solo.</div>";
    var mtP = mantenimiento(P.M);
    h += "<div style='color:#9aa3b2;font-size:11.5px'>Gatitos: " + P.M.N + " libres + " + P.M.nFijos + " farmers" +
      (Object.keys(mtP).length ? " · siempre " + textoMant(mtP) + " para mantener andando " + nombresConv(P.M) : "") +
      ". Los libres juntan <b>un recurso a la vez</b>: terminan uno y pasan al siguiente.</div>";
    h += htmlPasos(P);
    h += "<div><b>Qué te frena</b> (con todos los libres en su mejor oficio):<ul style='margin:2px 0 6px 18px;padding:0'>";
    P.porRec.slice(0, 5).forEach(function (x) {
      h += "<li>" + titulo(x.r) + ": falta " + num(x.falta) + " → " + tiempo(x.t) + (x.solo ? " <span style='color:#9aa3b2'>(no depende de gatitos)</span>" : x.conv ? " con tus " + x.conv + " a tope (necesitan sus insumos)" : " con " + (JT[x.job] || x.job)) + "</li>";
    });
    h += "</ul></div>";
    h += "<div style='color:#9aa3b2;font-size:11.5px'>Caza: " + Math.round(P.M.caza.furs) + " furs y " + Math.round(P.M.caza.ivory) + " ivory por caza (bono " + P.M.caza.bono.toFixed(1) + "). " +
      "Catnip: promedio del año " + num(P.M.cat.prom) + "/s, invierno " + num(P.M.cat.invierno) + "/s. Calculado en " + P.ms + " ms.</div>";
    if (!d.ejecutando) h += "<div style='margin-top:6px'><button data-a='si' style='" + est + ";background:#2f6b45'>Sí, hazlo</button></div>";
    else h += "<div style='margin-top:6px'><button data-a='pausa' style='" + est + "'>" + (d.pausa ? "Reanudar" : "Pausar") + "</button> <button data-a='cancelar' style='" + est + ";background:#6b2f2f'>Cancelar plan</button>" +
      " <span style='color:#7fd19b'>" + (d.pausa ? "en pausa" : "ejecutando…") + "</span></div>";
    return h;
  }
  function pintar() {
    var h = '<div style="display:flex;align-items:center;gap:8px"><b style="flex:1">Planificador</b><button data-a="x" style="' + est + '">✕</button></div>';
    h += '<div style="display:flex;gap:6px;margin:8px 0;flex-wrap:wrap"><select id="kgP_meta" style="' + est + ';max-width:260px">' + opcionesMeta() + "</select>" +
      '<button data-a="calc" style="' + est + ';background:#2a4a6b">Calcular</button></div>';
    h += '<div id="kgP_plan">' + vista + "</div>";
    h += "<details data-det='auto' style='margin-top:8px'" + (abiertos.auto ? " open" : "") + "><summary><b>Automático</b></summary>";
    FUN.forEach(function (f) { h += '<label style="display:block"><input type="checkbox" data-k="' + f[0] + '"' + (d.on[f[0]] ? " checked" : "") + "> " + f[1] + "</label>"; });
    h += "</details>";
    if (infoUnicornio) h += "<div style='margin-top:6px;font-size:11.5px'><b>Unicorns:</b> " + infoUnicornio + "</div>";
    h += "<details data-det='datos' style='margin-top:6px'" + (abiertos.datos ? " open" : "") + "><summary><b>Datos</b></summary><div style='font-size:11.5px'>" + infoDatos() + "</div></details>";
    h += "<div style='margin-top:6px'><b>Resumen</b><div style='font-size:11.5px'>" + infoResumen() + "</div></div>";
    h += "<div style='margin-top:6px'><b>Bitácora</b><div style='font-size:11.5px;color:#c8cdd6;max-height:140px;overflow:auto'>" + (d.log.slice(0, 15).join("<br>") || "—") + "</div></div>";
    var sel = document.getElementById("kgP_meta"), valor = sel ? sel.value : null;
    caja.innerHTML = h;
    if (valor) { var s2 = document.getElementById("kgP_meta"); if (s2) s2.value = valor; }
  }
  caja.addEventListener("change", function (e) { var k = e.target.getAttribute && e.target.getAttribute("data-k"); if (k) { d.on[k] = e.target.checked; guardar(); } });
  // el panel se redibuja cada 2 s: recordar qué secciones dejó abiertas ("toggle" no sube, por eso se escucha en captura)
  caja.addEventListener("toggle", function (e) { var k = e.target.getAttribute && e.target.getAttribute("data-det"); if (k) abiertos[k] = e.target.open; }, true);
  async function calcularYMostrar(type, name, opts) {
    calculando = true; vista = pintarPlan(); pintar();
    try { d.plan = await calcularPlan(type, name, opts); anotar("Plan calculado para " + d.plan.label); }
    finally { calculando = false; }
  }
  caja.addEventListener("click", async function (e) {
    var a = e.target.getAttribute && e.target.getAttribute("data-a"); if (!a || calculando) return;
    try {
      if (a === "x") { clearInterval(timer); caja.remove(); return; }
      if (a === "calc") {
        if (d.ejecutando) { anotar("Primero cancela el plan actual."); pintar(); return; }
        var v = document.getElementById("kgP_meta").value.split("|");
        await calcularYMostrar(v[0], v[1]);
      }
      if (a === "si" && d.plan) { d.ejecutando = true; d.pausa = false; ultimoReparto = -999; empezarCronometro(); anotar("Ejecutando el plan: " + d.plan.label); }
      if (a === "pausa") { d.pausa = !d.pausa; cronometroPausa(); anotar(d.pausa ? "Plan en pausa" : "Plan reanudado"); }
      if (a === "resumen0") { d.tot = {}; d.totDesde = Date.now(); }
      if (a === "cancelar") { d.ejecutando = false; d.plan = null; d.modoEdificios = false; anotar("Plan cancelado"); }
      if (a === "edificios") { d.modoEdificios = true; ultimaBusqueda = -999; anotar("Modo edificios: compra el edificio que tarde menos"); }
      guardar(); vista = pintarPlan(); pintar();
    } catch (er) { console.error(er); anotar("Error: " + er.message); pintar(); }
  });

  // =================== BUCLE ===================
  var timer = setInterval(function () {
    segundos++;
    if (calculando) return;
    try { automaticos(); } catch (e) { console.error("[Planificador auto]", e); }
    try { pasoEjecutar(); } catch (e) { console.error("[Planificador plan]", e); anotar("Error: " + e.message); }
    if (d.plan && d.ejecutando && !d.pausa && (d.reestimar || segundos - ultimaReestimacion >= 300)) {
      ultimaReestimacion = segundos; d.reestimar = false;
      try { reestimar(); } catch (e) { console.error("[Planificador reestimar]", e); }
    }
    if (!d.plan && d.modoEdificios && d.on.edificios && !d.pausa && segundos - ultimaBusqueda >= 30) {
      ultimaBusqueda = segundos;
      siguienteEdificio().catch(function (e) { console.error(e); anotar("Edificios: error " + e.message); });
    }
    if (segundos % 10 === 0) guardar();
    if (segundos % 2 === 0) {
      if (document.activeElement && document.activeElement.id === "kgP_meta") return;
      vista = pintarPlan(); pintar();
    }
  }, 1000);

  window.__kgPlan = { timer: timer, caja: caja, d: d, _test: { simular: simular, calcularPlan: calcularPlan, medirSeguro: medirSeguro, opcionesUnicornio: opcionesUnicornio, reservas: reservas, caza: caza, zebras: zebras, pasosComercio: pasosComercio, infoDatos: infoDatos,
    planBarcos: planBarcos, efectoFestival: efectoFestival, festivalQuiere: festivalQuiere, oportunidad: oportunidad, lleno: lleno, infoResumen: infoResumen,
    mantenimiento: mantenimiento, oroATitanio: oroATitanio, asignar: asignar, politica: politica,
    rankingEdificios: rankingEdificios, siguienteEdificio: siguienteEdificio,
    colchones: colchones, consumoPorSeg: consumoPorSeg, encenderConsumidores: encenderConsumidores } };
  vista = pintarPlan(); pintar();
  if (retomar) { // la página se recargó con un plan en marcha: lo vuelve a calcular y sigue
    calcularYMostrar(retomar.meta.type, retomar.meta.name, { auto: !!retomar.meta.auto }).then(function () {
      if (d.plan) {
        d.ejecutando = true; d.pausa = !!retomar.pausa;
        ["inicio", "estimado", "pausado", "pausaDesde", "hechos"].forEach(function (k) { if (retomar.meta[k] !== undefined) d.plan[k] = retomar.meta[k]; }); // sigue el mismo cronómetro
        if (!d.plan.inicio) empezarCronometro();
        anotar("Retomé el plan: " + d.plan.label); guardar();
      }
      vista = pintarPlan(); pintar();
    }).catch(function (e) { console.error(e); anotar("No pude retomar el plan: " + e.message); });
  }
  console.log("Planificador listo. Reemplaza al script automático y al de reparto.");
})();
