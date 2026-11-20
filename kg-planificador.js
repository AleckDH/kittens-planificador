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
    ESCASOS_MAX_PCT: 0.7,  // modo edificios: como mucho este % de los libres mantiene los que consumen y los tratos gold → titanium
    COLCHON_SEG: 120,      // insumos que se guardan para los edificios que consumen: este tiempo de consumo
    MANT_MARGEN: 1.15,     // margen al calcular los gatitos de mantenimiento (los que quedan rinden menos que el promedio)
    MANT_MARGEN_CAT: 1.05, // margen para los hunters de las Mints: excedente mínimo (si igual baja, ajustarMantenimiento suma uno)
    SOSTENER_MAX: 10,      // como mucho tantos edificios por recurso para que no se acabe (p. ej. Oil Wells)
    ORO_TRATOS_PCT: 0.95,  // con el gold a este % del tope, el sobrante se cambia por lo que falte (o titanium)
    ORO_DEJAR_PCT: 0.8,    // …y se deja este % del tope de gold guardado
    ORO_RENTABLE_PCT: 0.8, // tratos rentables (idea de Kitten Scientists): solo con el gold por encima de este % del tope
    AYUDA_MIN_PCT: 0.03,   // un edificio que ayuda debe ahorrar al menos 1 min y este % del tiempo total
    CATNIP_MIN_REFINAR: 0.95, // nunca se refina catnip por debajo de este % del tope (ni para pagar tratos)
    FABRICAR_PCT: 0.05,    // beam/slab/plate al llenarse: cada segundo usa este % del material
    ANTES_TOPE_SEG: 10,    // los que se transforman (wood, minerals, iron, coal, oil) se fabrican antes: si en este tiempo llegarían al tope
    COLA_RETRASO_PCT: 0.05, // una ayuda para las metas siguientes de la cola no puede atrasar la meta actual más que esto
    PREFAB_PCT: 0.9,       // cola: con el insumo sobre este % del tope, fabrica lo que piden las metas siguientes…
    PREFAB_DEJAR_PCT: 0.75, // …sin bajarlo de este % (no le quita nada a la meta actual)
    ATASCO_SEG: 120,       // si el paso actual no avanza en este tiempo: aviso con lo que falta según el juego…
    ATASCO_RECALC_SEG: 600, // …y recalcula (como mucho una vez cada tanto, para no quedar en un bucle)
    LIMPIA_MIN_PCT: 0.01,  // medioambiente: el modo edificios prefiere un edificio que baje al menos este % de la pollution que entra
    EDIFICIOS_HORAS: 6,    // modo edificios: solo considera los que se alcanzan en este tiempo
    EDIFICIOS_EXCLUIR: ["unicornPasture"] // la Unicorn Pasture la decide "Invertir unicorns"
    // (2026-11-19: se sacó la regla de no comprar edificios con titanium: si llega antes a la meta, se gasta)
  };
  // ======================================================
  function tps() { return game.getTicksPerSecondUI ? game.getTicksPerSecondUI() : (game.ticksPerSecond || 5); } // velocidad real (con aceleración)
  var VIEJOS = [window.__kgAuto, window.__kgReparto, window.__kgPlan];
  VIEJOS.forEach(function (v) { if (!v) return; if (v.timer) clearInterval(v.timer); if (v.caja) v.caja.remove(); });

  var CLAVE = "kgPlanificador";
  var d = (window.__kgPlan && window.__kgPlan.d) || null, retomar = null;
  if (!d) { // al recargar la página: recupera opciones, bitácora y el plan que iba
    d = {};
    try { var g = JSON.parse(localStorage.getItem(CLAVE) || "{}"); d.on = g.on; d.log = g.log; d.tot = g.tot; d.totDesde = g.totDesde; d.modoEdificios = g.modoEdificios; d.historial = g.historial; d.apagadosMano = g.apagados || {}; d.cola = g.cola || []; d.colaActiva = !!g.colaActiva; if (g.meta && g.ejecutando) retomar = g; } catch (e) {}
  }
  d.on = Object.assign({ cielo: true, refinar: true, cazar: true, manuscript: true, steel: true, bsp: true, fe: true, unicornios: true,
    festival: true, oportunidad: true, escasos: true, oroTitanio: true, edificios: true, lider: true, mantenerSiempre: false, polucion: true, verde: true }, d.on || {}); // las opciones nuevas vienen encendidas
  d.log = d.log || [];
  d.cola = d.cola || [];        // cola: varias metas, una tras otra [{type, name, label}]
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
        cola: d.cola, colaActiva: !!d.colaActiva,
        meta: d.plan ? { type: d.plan.type, name: d.plan.name, auto: !!d.plan.auto, deCola: !!d.plan.deCola, metaHecha: !!d.plan.metaHecha, inicio: d.plan.inicio, estimado: d.plan.estimado, pausado: d.plan.pausado, pausaDesde: d.plan.pausaDesde, hechos: (d.plan.hechos || []).slice(-10) } : null,
        ejecutando: d.ejecutando, pausa: d.pausa, modoEdificios: !!d.modoEdificios, historial: d.historial.slice(0, 10), apagados: d.apagadosMano || {} }));
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
    var m = Math.round(s / 60); // redondeado primero: antes salía "5 h 60 min"
    return Math.floor(m / 60) + " h " + (m % 60) + " min";
  }
  function tiempoSeg(s) { // para la cuenta regresiva: con segundos bajo la hora, así se ve que baja
    if (s >= 3600 || !isFinite(s)) return tiempo(s);
    var m = Math.floor(s / 60), ss = Math.floor(s % 60);
    return m ? m + " min " + ("0" + ss).slice(-2) + " s" : ss + " s";
  }
  function textoLimite() { return A.HORAS_MAX >= 48 ? Math.round(A.HORAS_MAX / 24) + " días" : A.HORAS_MAX + " h"; }
  function hora(ts) { var t = ts ? new Date(ts) : new Date(); return ("0" + t.getHours()).slice(-2) + ":" + ("0" + t.getMinutes()).slice(-2); }
  function anotar(txt) { d.log.unshift(hora() + " " + txt); d.log.length = Math.min(d.log.length, 40); }
  function sumar(clave, n) { if (n > 0) d.tot[clave] = (d.tot[clave] || 0) + n; } // para el resumen
  // fabrica y anota en el resumen cuánto salió de verdad
  function craftear(nombre, veces) {
    if (!(veces >= 1)) return 0;
    if (nombre === "wood") { // refinar catnip: nunca bajar del 95 % del tope (los gatitos se mueren de hambre; pasó al pagar tratos con wood)
      var cn = R("catnip"), porVez = (game.workshop.getCraftPrice(game.workshop.getCraft("wood")).filter(function (p) { return p.name === "catnip"; })[0] || { val: 100 }).val;
      veces = Math.min(veces, Math.floor((cn.value - cn.maxValue * A.CATNIP_MIN_REFINAR) / porVez));
      if (!(veces >= 1)) return 0;
    }
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
    if (r && r.itemBought) { sumar("compras", 1); RECETAS = {}; verBld++; game.render && game.render(); return true; }
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
        // el catpower va en lo real: se reserva (los otros tratos no lo gastan) y la barra de avance lo muestra
        reales: [{ name: "gold", val: z.gold * k }, { name: z.compra, val: z.compraVal * k }, { name: "manpower", val: z.catpower * k }],
        // el catpower de los tratos se cuenta como furs que se dejan de cazar
        p: [{ name: "gold", val: z.gold * k }, { name: z.compra, val: z.compraVal * k }, { name: "furs", val: z.catpower * k / cz.costo * cz.furs }] });
    }
    return pasos;
  }
  // Lo que falta y nadie produce (ni gatitos ni edificios encendidos): se compra a la raza que más da por trato
  // (pedido el 2026-11-19: Telecommunication pide 50 uranium y el plan decía "nunca"; los Dragons lo venden por 250 titanium).
  // El titanium que piden esos tratos se suma a lo que se consigue con las Zebras.
  function pasosOtrasRazas(M, falta) {
    var out = [], opciones = null;
    Object.keys(falta).forEach(function (r) {
      if (r === "titanium" || !(falta[r] > 1e-9) || mejorJob(M, r)) return;
      if ((M.base[r] || 0) > 1e-9 || M.conv.some(function (c) { return c.outs[r] > 0; })) return; // ya entra (p. ej. Accelerator → uranium)
      opciones = opciones || tratosRazas();
      var mejor = null;
      opciones.forEach(function (o) { if (o.race.name !== "zebras" && o.da[r] > 0 && o.compra !== r && (!mejor || o.da[r] > mejor.da[r])) mejor = o; });
      if (mejor) out = out.concat(pasosRaza(mejor, r, falta[r]));
    });
    return out;
  }
  function pasosRaza(o, r, cant) {
    var cz = caza(), n = Math.ceil(cant / o.da[r]), pasos = [];
    var porTanda = Math.max(1, Math.min(n, Math.floor((R("gold").maxValue || Infinity) / o.gold), Math.floor((R(o.compra).maxValue || Infinity) / o.compraVal), 50));
    for (var h = 0; h < n; h += porTanda) {
      var k = Math.min(porTanda, n - h), gana = {}; gana[r] = o.da[r] * k;
      pasos.push({ type: "trade", name: o.race.name, k: k, motivo: r, gana: gana,
        reales: [{ name: "gold", val: o.gold * k }, { name: o.compra, val: o.compraVal * k }, { name: "manpower", val: o.catpower * k }],
        p: [{ name: "gold", val: o.gold * k }, { name: o.compra, val: o.compraVal * k }, { name: "furs", val: o.catpower * k / cz.costo * cz.furs }] });
    }
    return pasos;
  }
  function textoGana(p) { return Object.keys(p.gana || {}).map(function (r) { return "~" + num(p.gana[r]) + " " + titulo(r); }).join(", "); }
  function nombreRaza(n) { var r = game.diplomacy.get(n); return (r && r.title) || n; }
  // un trato para la simulación: paga gold y slabs, y su catpower (mp) sale del catpower real más lo que cazan los hunters.
  // Antes se pagaba con furs: con furs guardados todos los tratos de la cola salían al instante (8 Bio Labs "~ya" con 10 de catpower)
  function itemTrato(s) {
    var mp = 0, p = (s.reales || s.p).filter(function (x) { if (x.name === "manpower") { mp += x.val; return false; } return x.name !== "furs"; });
    if (!mp) { var cz = caza(), f = (s.p || []).filter(function (x) { return x.name === "furs"; })[0]; if (f) mp = f.val / cz.furs * cz.costo; } // plan de antes
    return { p: p, gana: s.gana, mp: mp };
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
    // el invierno se mide con clima frío (−15 %): así los farmers alcanzan aunque toque un invierno malo
    try { for (var s = 0; s < 4; s++) { cal.season = s; cal.weather = s === 3 ? "cold" : null; v.push(game.calcResourcePerTick("catnip") * tps()); } }
    finally { cal.season = s0; cal.weather = w0; }
    return { prom: (v[0] + v[1] + v[2] + v[3]) / 4, invierno: v[3], v: v };
  }

  // orden para elegir los farmers fijos: nunca el líder; primero los que ya son farmers y los de más experiencia
  function ordenGatitos(kittens, orig) {
    return kittens.map(function (k, i) { return i; }).sort(function (a, b) {
      var la = kittens[a].isLeader ? 1 : 0, lb = kittens[b].isLeader ? 1 : 0;
      if (la !== lb) return la - lb;
      var fa = orig[a] === "farmer" ? 1 : 0, fb = orig[b] === "farmer" ? 1 : 0;
      if (fa !== fb) return fb - fa;
      return ((kittens[b].skills || {}).farmer || 0) - ((kittens[a].skills || {}).farmer || 0);
    });
  }
  function medir(nFijos) {
    var kittens = game.village.sim.kittens, orig = kittens.map(function (k) { return k.job; });
    var jobs = game.village.jobs.filter(function (j) { return j.unlocked && j.name !== "engineer"; }).map(function (j) { return j.name; });
    var orden = ordenGatitos(kittens, orig);
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
  // Antes medía todo (cada gatito en cada oficio) por cada cantidad de farmers que probaba: con 12 farmers fijos
  // eran 9 mediciones completas cada 30 s. Ahora prueba solo el catnip (rápido) y mide una vez.
  function catnipAlcanza(nF) {
    var kittens = game.village.sim.kittens, orig = kittens.map(function (k) { return k.job; }), orden = ordenGatitos(kittens, orig), cat;
    try {
      orden.forEach(function (i, n) { kittens[i].job = n < nF ? "farmer" : null; }); // los libres sin oficio: también comen
      game.village.updateHappines(); game.village.updateResourceProduction();
      cat = catnipEstaciones();
    } finally {
      kittens.forEach(function (k, i) { k.job = orig[i]; });
      game.village.updateHappines(); game.village.updateResourceProduction();
    }
    return cat.prom >= 0 && (cat.invierno >= 0 || R("catnip").value + cat.invierno * 200 >= 0);
  }
  function medirSeguro() {
    var nF = A.FARMERS_MIN, tot = game.village.sim.kittens.length;
    while (nF < tot && !catnipAlcanza(nF)) nF++;
    return medir(nF);
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
      if (esFab(n)) {
        // el juego fabrica por tandas enteras: si falta 0,056 de concrete hay que juntar una tanda completa
        // (2500 slab + 25 steel); contando fracciones pedía unos pocos slabs y el plan quedaba trabado
        var r = rec(n), veces = Math.ceil(cant / r.rinde - 1e-6);
        pool[n] = (pool[n] || 0) + Math.max(0, veces * r.rinde - cant); // lo que sobra de la tanda sirve para lo que sigue
        Object.keys(r.porVez).forEach(function (q) { pedir(q, r.porVez[q] * veces); });
      }
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
      // si ese recurso ya está lleno (p. ej. iron al tope), producir más no sirve: lo que frena es lo que hace falta
      // para fabricar con él (coal para el steel), así que no se juntan wood/minerals para los Smelters
      var tope = R(r) && R(r).maxValue; if (tope > 0 && ((st || {})[r] || 0) >= tope * 0.98) return;
      var c = M.conv.filter(function (x) { return x.outs[r] > 0; })[0]; if (!c) return;
      Object.keys(c.ins).forEach(function (q) {
        var nec = falta[r] * c.ins[q] / c.outs[r], hay = usado[q] ? 0 : ((st || {})[q] || 0);
        usado[q] = true;
        if (nec > hay) falta[q] = (falta[q] || 0) + nec - hay;
      });
    });
    return falta;
  }
  // lo que se comen por segundo los edificios encendidos que consumen (Smelters: wood y minerals, Calciner, Mints, Brewery…)
  function consumoConv(M) {
    var c = {};
    (M.conv || []).forEach(function (x) { Object.keys(x.ins).forEach(function (r) { c[r] = (c[r] || 0) + x.ins[r]; }); });
    return c;
  }
  // mientras se junta un recurso, los otros se siguen consumiendo (p. ej. los Smelters se comen la wood mientras
  // todos están de miners): a cada recurso consumido le suma lo que se gasta durante las etapas de los demás
  function conConsumo(M, falta, cons, stc, preciosLista) {
    var N = M.N, extra = {}, rs = Object.keys(cons);
    if (!rs.length) return falta;
    var bruto = faltante({}, preciosLista); // lo que pide la compra, sin contar lo que ya hay
    for (var it = 0; it < 3; it++) {
      var tJob = {}, T = 0, ok = true;
      Object.keys(falta).concat(rs).forEach(function (r) {
        var f = (falta[r] || 0) + (extra[r] || 0); if (!(f > 0)) return;
        var j = mejorJob(M, r); if (!j) return;
        var neto = (M.base[r] || 0) + M.m[j][r] * N - (cons[r] || 0);
        if (!(neto > 0)) { ok = false; return; }
        tJob[j] = Math.max(tJob[j] || 0, f / neto);
      });
      if (!ok) break;
      Object.keys(tJob).forEach(function (j) { T += tJob[j]; });
      rs.forEach(function (r) {
        if (!bruto[r] && !falta[r]) return; // la compra no lo usa
        var j = mejorJob(M, r), gasta = cons[r] * Math.max(0, T - (j ? tJob[j] || 0 : 0));
        var sobra = falta[r] > 0 ? 0 : Math.max(0, (stc[r] || 0) - (bruto[r] || 0));
        extra[r] = Math.max(0, gasta - sobra);
      });
    }
    var o = Object.assign({}, falta);
    Object.keys(extra).forEach(function (r) { if (extra[r] > 0) o[r] = (o[r] || 0) + extra[r]; });
    return o;
  }
  function estaLleno(r, st) { var tope = R(r) && R(r).maxValue; return tope > 0 && (st[r] || 0) >= tope * 0.99; }
  // despues: los precios de los pasos (y metas de la cola) que siguen; se usan solo si para el paso actual
  // ningún oficio sirve (lo que falta no depende de gatitos o ya está lleno, p. ej. science a tope por los eventos del cielo)
  function politica(M, st, preciosLista, jobActual, despues) {
    var stc = sinCol(st, colchones()); // la reserva de insumos no cuenta como disponible
    var N = M.N, cons = consumoConv(M);
    function etapa(lista) {
      var falta = conConsumo(M, pasarConversores(M, faltante(stc, lista), stc), cons, stc, lista), peor = null, pt = -1, porJob = {}, recJob = {};
      Object.keys(falta).forEach(function (r) {
        var j = mejorJob(M, r); if (!j) return;
        var v = falta[r] / Math.max(1e-9, (M.base[r] || 0) + M.m[j][r] * N - (cons[r] || 0));
        // un recurso lleno que todavía "falta" (no se puede fabricar con él por ahora) no sirve para seguir en ese oficio
        if (estaLleno(r, st)) return;
        if (v > (porJob[j] || 0)) { porJob[j] = v; recJob[j] = r; }
        if (v > pt) { pt = v; peor = j; }
      });
      return { peor: peor, porJob: porJob, recJob: recJob, falta: falta };
    }
    var e = etapa(preciosLista), peor = e.peor;
    // una etapa a la vez: se queda en el oficio actual hasta juntar todo lo de ese oficio, y recién ahí cambia
    if (jobActual && e.porJob[jobActual] > 0) peor = jobActual;
    if (!peor && despues && despues.length) { // nada que juntar para este paso: adelanta lo que piden los siguientes
      e = etapa(preciosLista.concat(despues)); peor = e.peor;
      if (jobActual && e.porJob[jobActual] > 0) peor = jobActual;
    }
    ultimaEtapa = { job: peor, recurso: peor ? e.recJob[peor] : null, falta: peor ? e.falta[e.recJob[peor]] : 0 };
    if (!peor) { // ni eso: a un oficio que produzca algo que no esté lleno (antes iban todos a scholar, con la science a tope)
      var sirve = function (j) { return j && M.m[j] && Object.keys(M.m[j]).some(function (r) { return M.m[j][r] > 0 && r !== "catnip" && !estaLleno(r, st); }); };
      var orden = [jobActual, "scholar", "woodcutter", "miner", "geologist", "hunter"].concat(M.jobs);
      for (var io = 0; io < orden.length && !peor; io++) if (M.jobs.indexOf(orden[io]) >= 0 && sirve(orden[io])) peor = orden[io];
      if (!peor) peor = M.jobs.indexOf("scholar") >= 0 ? "scholar" : M.jobs[0];
    }
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
          var k = Math.ceil(Math.max(0, nec[q] * (q === "manpower" ? A.MANT_MARGEN_CAT : A.MANT_MARGEN) -(conExtra ? (M.base[q] || 0) : 0)) / por) + (conExtra ? ((d.mantExtra || {})[j + "|" + q] || 0) : 0);
          if (k > 0) out.push({ j: j, k: k });
        });
        return out;
      };
      // 1.º: los insumos de todos los edificios que consumen (Smelters, Calciner, Mints…), con el consumo total que da el juego
      var nec = {};
      M.conv.forEach(function (c) { Object.keys(c.ins).forEach(function (q) { nec[q] = (nec[q] || 0) + c.ins[q]; }); });
      game.resPool.resources.forEach(function (r) { var c = consumoPorSeg(r.name); if (c > (nec[r.name] || 0)) nec[r.name] = c; });
      gatitos(nec, true).forEach(function (x) { var k = Math.min(x.k, tope - total); if (k > 0) { o[x.j] = (o[x.j] || 0) + k; total += k; } });
      // 2.º (solo modo edificios): lo que piden los tratos gold → titanium (minerals para los slabs y catpower); si no entra todo, en proporción
      var tr = gatitos(esAuto() ? slabsParaTratos(M) : {}, false), pide = tr.reduce(function (s, x) { return s + x.k; }, 0), queda = tope - total;
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
      else if (q === "manpower") { // catpower: siempre ganando, pero de a poco. Solo saca un hunter si sin él igual sube
        // (antes lo sacaba con el 10 % de sobra: un hunter rinde más que eso, así que subía y bajaba cada 30 s: −0,47/s)
        if (ex > 0 && neto - (M.mpCrudo[j] || 0) * A.MANT_MARGEN > 0) d.mantExtra[clave] = ex - 1;
      }
      else if (ex > 0 && neto > nec[q] * 0.25) d.mantExtra[clave] = ex - 1;
    });
  }
  // cuánto consumen por segundo los edificios encendidos (Con = conversores; PerTick negativo = Magneto con el oil)
  // Consumo por edificio que el juego recalcula según lo que hay (js/buildings.js, "action"): si el insumo se acabó,
  // el juego informa 0, pero el edificio lo consume apenas aparece. Para eso se usa el consumo completo.
  var CONSUMO_BASE = { mint: { manpower: 0.75, gold: 0.005 } };
  // Se calcula para todos los recursos de una pasada y se guarda medio segundo (o hasta que cambien los edificios):
  // antes recorría todos los edificios por cada recurso, y colchones() lo pedía para todos en cada reparto simulado.
  var verBld = 0, consCache = null; // verBld sube cada vez que se prueba un edificio de más (conEdificio)
  function consumos() {
    var ahora = Date.now(), t = tps();
    if (consCache && consCache.ver === verBld && consCache.tps === t && ahora - consCache.ts < 500) return consCache;
    var v = {};
    game.bld.buildingsData.forEach(function (b) {
      if (!b.on) return;
      var ef = b.effects || {};
      Object.keys(ef).forEach(function (k) { if (ef[k] < 0 && /PerTick$/.test(k)) { var r = k.slice(0, -7); v[r] = (v[r] || 0) - ef[k] * b.on; } });
      // lo que le falta para el consumo completo; b.effects es por edificio (el juego lo multiplica por b.on):
      // antes se restaba una sola vez y con 5 Mints contaba 6,75 de catpower por tick en vez de 3,75 (casi el doble de hunters)
      var base = CONSUMO_BASE[b.name];
      if (base) Object.keys(base).forEach(function (r) { v[r] = (v[r] || 0) + Math.max(0, (base[r] + Math.min(0, ef[r + "PerTickCon"] || 0)) * b.on); });
    });
    return (consCache = { ver: verBld, tps: t, ts: ahora, v: v, con: {} });
  }
  function consumoPorSeg(r) {
    var m = consumos();
    if (!(r in m.con)) m.con[r] = -Math.min(0, game.getEffect(r + "PerTickCon") || 0);
    return (m.con[r] + (m.v[r] || 0)) * m.tps;
  }
  // reserva de insumos que nadie gasta, para que esos edificios no se queden sin nada y se apaguen
  // la reserva nunca impide una compra que llena justo el tope
  function colPara(col, x, tope) { return Math.max(0, Math.min(col[x.name] || 0, (tope || Infinity) - x.val)); }
  // stock sin la reserva de insumos (lo que de verdad se puede usar)
  function sinCol(st, col) { var o = Object.assign({}, st); Object.keys(col || {}).forEach(function (r) { o[r] = Math.max(0, (o[r] || 0) - col[r]); }); return o; }
  function colchonesBase() { // siempre, para lo que nunca debe dejar sin insumos a los Smelters (p. ej. hacer slabs para tratos)
    var o = {}; game.resPool.resources.forEach(function (r) { var c = consumoPorSeg(r.name); if (c > 0) o[r.name] = c * A.COLCHON_SEG; });
    return o;
  }
  function colchones() {
    var o = {}; if (!mantActivo()) return o;
    game.resPool.resources.forEach(function (r) { var c = consumoPorSeg(r.name); if (c > 0) o[r.name] = c * A.COLCHON_SEG; });
    return o;
  }
  // edificios que gastan recursos y el juego apagó (p. ej. Magnetos sin oil): se vuelven a encender si hay insumos
  // edificios que la usuaria apagó a mano: no se vuelven a encender y el plan se recalcula sin ellos
  var onPrev = null;
  var APAGA_JUEGO = { smelter: 1, magneto: 1, reactor: 1 }; // los únicos que el juego apaga solo (buildings.js); el resto (Mints…) solo lo apaga ella
  function faltaInsumo(b) { // el juego los apaga solo cuando se acaba un insumo (p. ej. Magnetos sin oil)
    if (!APAGA_JUEGO[b.name]) return false;
    var ef = b.effects || {};
    return Object.keys(ef).some(function (k) {
      if (!/PerTick(Con)?$/.test(k) || !(ef[k] < 0)) return false;
      var r = R(k.replace(/PerTick(Con)?$/, ""));
      return r && r.value < -ef[k] * Math.max(1, b.val) * tps() * 5;
    });
  }
  function vigilarApagados() {
    d.apagadosMano = d.apagadosMano || {};
    var cambio = false, primera = !onPrev; onPrev = onPrev || {};
    game.bld.buildingsData.forEach(function (b) {
      if (typeof b.on !== "number") return;
      var antes = onPrev[b.name]; onPrev[b.name] = { on: b.on, val: b.val };
      var nom = etiqueta("buildings", b.name);
      if (primera) { // al cargar: si ya hay apagados con insumos de sobra, los apagó ella
        if (b.val && b.on < b.val && !faltaInsumo(b) && !d.apagadosMano[b.name]) { d.apagadosMano[b.name] = true; anotar("Dejo apagados los " + nom + " que están apagados"); }
        return;
      }
      if (!antes || b.on === antes.on) return;
      if (b.on < antes.on && !faltaInsumo(b)) {
        d.apagadosMano[b.name] = true; cambio = true;
        anotar("Apagaste " + (antes.on - b.on) + " " + nom + ": no lo vuelvo a encender y recalculo sin él");
      } else if (d.apagadosMano[b.name] && b.on - antes.on > (b.val || 0) - (antes.val || 0)) { // lo encendió ella (no es solo uno nuevo)
        delete d.apagadosMano[b.name]; cambio = true;
        anotar("Encendiste " + nom + ": vuelvo a mantenerlo y recalculo");
      }
    });
    if (cambio) { guardar(); recalcularPorApagado(); }
  }
  function recalcularPorApagado() {
    ultimoReparto = -999;
    if (!d.plan) { ultimaBusqueda = -999; return; }
    if (d.plan.auto) { d.plan = null; ultimaBusqueda = -999; return; } // modo edificios: vuelve a elegir con lo que hay encendido
    recalcular().then(function () { guardar(); vista = pintarPlan(); pintar(); })
      .catch(function (e) { console.error(e); anotar("No pude recalcular: " + e.message); });
  }
  function encenderConsumidores() {
    game.bld.buildingsData.forEach(function (b) {
      if (!b.val || typeof b.on !== "number" || b.on >= b.val) return;
      if ((d.apagadosMano || {})[b.name] || !APAGA_JUEGO[b.name]) return; // lo apagó ella (o el juego nunca lo apaga solo)
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
    // beam/slab/plate con lo que se desborda (el automático usa hasta el 5 % del material por segundo)
    if (d.on.bsp) [["wood", "beam"], ["minerals", "slab"], ["iron", "plate"], ["oil", delOil()]].forEach(function (x) {
      var r = x[0], prod = x[1], rc = rec(prod); if (!(sobra[r] > 0) || !rc) return;
      var porVez = rc.porVez[r] || 0; if (!porVez) return;
      var usa = Math.min(sobra[r], (st[r] || 0) * A.FABRICAR_PCT) * dt;
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
    var est = { ultSteel: 0, z: null, cz: caza(), barcos0: R("ship").value, ritmo: mantActivo() && esAuto() ? slabsParaTratos(M) : {}, cuenta: {} };
    // catpower para los tratos: el de ahora más lo que juntan los hunters (en M, lo que cazan figura como furs)
    var mp = R("manpower").value, mpCap = isFinite(cap.manpower) ? cap.manpower : Infinity;
    var mpPide = function (it) { return it.mp ? Math.min(it.mp, mpCap * 0.9) : 0; };
    var mpRitmo = function () { return Object.keys(alloc || {}).reduce(function (s, j) { return s + alloc[j] * (((M.m[j] || {}).furs) || 0); }, 0) * est.cz.costo / Math.max(1e-9, est.cz.furs); };
    var hacer = function (n, cant, nivel, reserva) {
      if (cant <= 1e-9 || nivel > 6) return;
      var rc = rec(n), pv = rc.porVez, veces = Math.ceil(cant / rc.rinde - 1e-6); // por tandas enteras, como el juego
      Object.keys(pv).forEach(function (q) {
        if (!esFab(q)) return;
        var nec = pv[q] * veces + (reserva[q] || 0) - (st[q] || 0);
        if (nec > 0) hacer(q, nec, nivel + 1, reserva);
      });
      var mm = veces;
      Object.keys(pv).forEach(function (q) { mm = Math.min(mm, Math.floor(Math.max(0, (st[q] || 0) - (reserva[q] || 0)) / pv[q] + 1e-9)); });
      if (mm > 0) { Object.keys(pv).forEach(function (q) { st[q] -= pv[q] * mm; }); st[n] = (st[n] || 0) + mm * rc.rinde; }
    };
    var guardia = 0, vuelta = null; // vuelta: un efecto que dura un tiempo (festival): cuándo termina y la medición sin él
    while (k < items.length && t < limite && guardia++ < 200000) {
      if (vuelta && t >= vuelta.t - 1e-6) { M = vuelta.M; vuelta = null; alloc = null; } // terminó el festival
      if (kRes !== k) { // lo que el resto del plan necesita: los automáticos de la simulación no lo tocan
        kRes = k; resRaw = faltante({}, items.slice(k).map(function (x) { return x.p; }));
        // lo fabricado que piden directo (parchment del festival, slabs, plates…) también: antes los manuscripts simulados
        // se comían el parchment del festival y juntarlo daba 5 h en vez de ~15 min
        items.slice(k).forEach(function (x) { x.p.forEach(function (y) { if (esFab(y.name)) resRaw[y.name] = (resRaw[y.name] || 0) + y.val; }); });
        est.z = zebras((st.ship || 0) - est.barcos0);
      }
      if (alloc === null || t - ultPol >= SIM_REPARTO_SEG) {
        // el reparto apunta a la compra que sigue (lo que tiene tope no se puede juntar por adelantado)
        var pPol = items[k].p, mpDef = Math.max(0, mpPide(items[k]) - mp);
        if (mpDef > 0) pPol = pPol.concat([{ name: "furs", val: (st.furs || 0) + mpDef / est.cz.costo * est.cz.furs }]); // falta catpower: hunters
        var na = politica(M, st, [pPol], alloc ? Object.keys(alloc)[0] : null, items.slice(k + 1).map(function (x) { return x.p; })), nj = Object.keys(na)[0];
        var ue = ultimaEtapa || {}, ult = etapas[etapas.length - 1];
        if (!ult || ult.job !== nj || ult.paso !== k || ult.recurso !== ue.recurso) etapas.push({ job: nj, desde: t, paso: k, recurso: ue.job === nj ? ue.recurso : null });
        alloc = na; rates = tasas(M, alloc); ultPol = t;
      }
      // fabricar en cadena lo que pide la compra actual (sin tocar lo fabricado que el edificio pide directo)
      var pr = items[k].p, reserva = Object.assign({}, col); // al fabricar tampoco se toca la reserva de insumos
      reserva.furs = (reserva.furs || 0) + A.RESERVA_FURS; // ni los furs que siempre se dejan (como fabricarHacia)
      pr.forEach(function (y) { if (esFab(y.name)) reserva[y.name] = (reserva[y.name] || 0) + y.val; });
      pr.forEach(function (x) {
        if (!esFab(x.name)) return;
        var falta = x.val - (st[x.name] || 0); if (falta <= 0) return;
        reserva[x.name] = 0; hacer(x.name, falta, 0, reserva); reserva[x.name] = x.val;
      });
      var compro = false;
      while (k < items.length && mp >= mpPide(items[k]) - 1e-6 && items[k].p.every(function (x) { return (st[x.name] || 0) >= x.val + colPara(col, x, cap[x.name]) - 1e-6; })) {
        items[k].p.forEach(function (x) { st[x.name] -= x.val; });
        var it = items[k]; mp = Math.max(0, mp - mpPide(it));
        if (it.cap) Object.keys(it.cap).forEach(function (r) { cap[r] = (cap[r] || 0) + it.cap[r]; });
        if (it.gana) Object.keys(it.gana).forEach(function (r) { st[r] = Math.min(isFinite(cap[r]) ? cap[r] : Infinity, (st[r] || 0) + it.gana[r]); });
        if (it.M) {
          if (it.dur) vuelta = { t: t + it.dur, M: M }; // festival: produce más durante it.dur y después vuelve
          else if (vuelta) vuelta.M = it.M; // un edificio nuevo durante el festival: su medición es sin festival (se pierde el resto del bono: estimación prudente)
          M = it.M;
        }
        it.t = t; k++; alloc = null; compro = true;
      }
      if (compro || k >= items.length) continue; // con la compra hecha, nuevo reparto antes de avanzar
      var nn = netos(M, rates, st, cap), net = nn.net;
      // ¿cuánto falta para el próximo evento?
      var dt = Math.min(SIM_MAX_SALTO, SIM_REPARTO_SEG - (t - ultPol), limite - t);
      var fa = faltante(sinCol(st, col), [items[k].p]), tAlc = 0;
      Object.keys(fa).forEach(function (r) { tAlc = Math.max(tAlc, (net[r] || 0) > 1e-9 ? fa[r] / net[r] : Infinity); });
      var mpR = mpRitmo(), mpN = mpPide(items[k]);
      if (mpN > mp && mpR > 1e-9) tAlc = Math.max(tAlc, (mpN - mp) / mpR); else if (mpN > mp) tAlc = Infinity;
      if (tAlc > 0) dt = Math.min(dt, tAlc);
      if (vuelta) dt = Math.min(dt, vuelta.t - t);
      Object.keys(net).forEach(function (r) {
        var v = net[r], s = st[r] || 0;
        if (v > 1e-9 && isFinite(cap[r]) && s < cap[r]) dt = Math.min(dt, (cap[r] - s) / v);
        if (v < -1e-9 && s > 1e-6) dt = Math.min(dt, s / -v);
      });
      dt = Math.max(SIM_MIN_SALTO, dt);
      Object.keys(net).forEach(function (r) { st[r] = Math.max(0, Math.min(isFinite(cap[r]) ? cap[r] : Infinity, (st[r] || 0) + net[r] * dt)); });
      automaticosSim(st, cap, net, nn.sobra, dt, resRaw, col, t, est);
      mp = Math.min(mpCap, mp + mpR * dt);
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
  function textoAhorro(x) { return isFinite(x) ? "ahorra " + tiempo(x) : "sin esto no se llega"; }

  // =================== ALMACENAMIENTO Y EDIFICIOS ===================
  function refrescar(meta) { verBld++; game.updateCaches(); if (meta && meta.calculateEffects) meta.calculateEffects(meta, game); game.updateCaches(); }
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
      verBld++; game.updateCaches();
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
      if (!b.unlocked || contamina(b.name)) return; // medioambiente: el tope se sube con edificios que no contaminan
      var dmax = null;
      try { dmax = conEdificio(b.name, function () { var t1 = topes(), o = {}; recursos.forEach(function (r) { o[r] = (t1[r] || 0) - (t0[r] || 0); }); return o; }); } catch (e) { return; }
      if (!recursos.some(function (r) { return dmax[r] > 1e-6; })) return;
      cand.push({ name: b.name, dmax: dmax });
    });
    await esperar();
    if (!cand.length) return { pasos: [], extra: {}, imposible: falta };
    // por cada recurso que falta: va eligiendo de a un edificio, el que más tope da por el tiempo que agrega
    // (así puede mezclar tipos: p. ej. Academies baratas primero y Observatories después, en vez de un solo tipo cada vez más caro)
    var itemsDe = function (l) { return l.map(function (x) { return { p: x.p, cap: x.cap }; }); };
    for (var ir = 0; ir < recursos.length; ir++) {
      var r = recursos[ir], lista = [], acum = 0, extraC = Object.assign({}, extra);
      var tPrev = pasos.length ? tcomp(simular(M, itemsDe(pasos))) : 0;
      for (var n = 0; acum < falta[r] - 1e-6 && n < 40; n++) {
        var mejorC = null;
        for (var ic = 0; ic < cand.length; ic++) {
          var c = cand[ic]; if (!(c.dmax[r] > 1e-6)) continue;
          var ya = pasos.concat(lista).filter(function (x) { return x.name === c.name; }).length;
          var p = game.bld.getPrices(c.name, ya);
          if (!p.every(function (x) { var rr = R(x.name); return !rr.maxValue || x.val <= rr.maxValue + (extraC[x.name] || 0); })) continue; // no cabe
          var paso = { type: "buildings", name: c.name, p: p, cap: c.dmax, motivo: "almacenamiento" };
          var t = tcomp(simular(M, itemsDe(pasos.concat(lista, [paso]))));
          // si hoy no se llega nunca (falta algo que las ayudas pueden destrabar), igual se elige: el que más tope da
          var punt = isFinite(t) ? Math.min(c.dmax[r], falta[r] - acum) / Math.max(1, t - tPrev) : c.dmax[r] * 1e-12;
          if (!mejorC || punt > mejorC.punt) mejorC = { paso: paso, t: isFinite(t) ? t : tPrev, punt: punt, c: c };
        }
        await esperar();
        if (!mejorC) break;
        lista.push(mejorC.paso); acum += mejorC.c.dmax[r]; tPrev = mejorC.t;
        Object.keys(mejorC.c.dmax).forEach(function (q) { extraC[q] = (extraC[q] || 0) + mejorC.c.dmax[q]; });
      }
      if (acum < falta[r] - 1e-6) continue;
      pasos = pasos.concat(lista); extra = extraC; falta[r] = 0;
    }
    return { pasos: pasos, extra: extra, imposible: recursos.some(function (r) { return falta[r] > 1e-6; }) ? falta : null };
  }

  // edificios que adelantan la meta (contando lo que cuestan)
  // Con más metas en la cola (sig): elige lo que termina la cola entera antes, pero sin atrasar esta meta
  // más de COLA_RETRASO_PCT (p. ej. Smelters para el iron que pide la última, si no frenan a la primera).
  async function planAyudas(M, items, tBase, sig) {
    var colaModo = false, tMeta0 = tBase, iMeta = items.length - 1;
    if (sig && sig.length) {
      var rq0 = simular(M, items.concat(sig).map(function (x) { return Object.assign({}, x); }));
      if (isFinite(rq0.t)) { colaModo = true; items = items.concat(sig); tBase = rq0.t; }
    }
    var stock = {}; game.resPool.resources.forEach(function (r) { stock[r.name] = r.value; });
    var necesarios = faltante(stock, items.map(function (i) { return i.p; }));
    var nec = Object.keys(necesarios); if (!nec.length) return [];
    if (necesarios.furs || necesarios.ivory) nec.push("manpower");
    var elegidos = [], M0 = M;
    // medioambiente: los que suben la pollution no son ayuda (se mide antes, sin los edificios de prueba puestos)
    var sucios = {}; game.bld.buildingsData.forEach(function (b) { if (b.unlocked && contamina(b.name)) sucios[b.name] = true; });
    var nombres = function () { return elegidos.map(function (e) { return e.name; }); };
    // arma la lista a simular: las ayudas "antes" van primero; las "después" (solo cola), justo tras la meta actual
    var armar = function (nuevo, despues) {
      var it = function (e) { return { p: e.p, M: e.M }; };
      var antes = elegidos.filter(function (e) { return !e.despues; }).map(it), tras = elegidos.filter(function (e) { return e.despues; }).map(it);
      if (nuevo) (despues ? tras : antes).push(nuevo);
      var cp = items.map(function (x) { return Object.assign({}, x); });
      return { lista: antes.concat(cp.slice(0, iMeta + 1)).concat(tras).concat(cp.slice(iMeta + 1)), iM: antes.length + iMeta };
    };
    for (var vuelta = 0; vuelta < A.MAX_EDIFICIOS_AYUDA; vuelta++) {
      var cand = [];
      // todo se mide como si ya tuvieras los edificios elegidos antes (así el 2.º Oil Well cuenta sobre el 1.º)
      conVarios(nombres(), function () {
        var baseRates = prodActual(), feliz0 = game.village.happiness;
        game.bld.buildingsData.forEach(function (b) {
          if (!b.unlocked || sucios[b.name] || consumeSinSostener(b, M0, true)) return; // p. ej. un Magneto más con el oil bajando (en cualquier modo)
          var p = game.bld.getPrices(b.name, elegidos.filter(function (e) { return e.name === b.name; }).length);
          if (game.resPool.isStorageLimited(p)) return; // no cabe en tu almacenamiento (función del juego)
          var delta, feliz1 = feliz0;
          try { delta = conEdificio(b.name, function () { var o = prodActual(); feliz1 = game.village.happiness; var dd = {}; nec.forEach(function (r) { dd[r] = (o[r] || 0) - (baseRates[r] || 0); }); return dd; }); } catch (e) { return; }
          // sirve si sube la producción de algo necesario (o lo potencia aunque hoy nadie trabaje en eso)
          var ef = b.effects || {};
          var directo = Object.keys(ef).some(function (k) { return !/Max$/.test(k) && nec.some(function (r) { return k.indexOf(r) === 0 && (ef[k] || 0) > 0; }); });
          // si lo único que cambia es la felicidad (Temple, Amphitheatre…), no cuenta: sube todo un poquito, pero gasta gold, manuscripts…
          if (!directo && Math.abs((feliz1 || 0) - (feliz0 || 0)) > 1e-9) return;
          var gana = directo || nec.some(function (r) { return delta[r] > 1e-9; });
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
        var c = cand[ic];
        // con cola: antes de la meta actual (si no la atrasa) o justo después (no la toca: es para las siguientes)
        var lugares = colaModo ? [false, true] : [false];
        for (var il = 0; il < lugares.length; il++) {
          var despues = lugares[il], M2;
          var conQue = (despues ? nombres() : elegidos.filter(function (e) { return !e.despues; }).map(function (e) { return e.name; })).concat([c.name]);
          try { M2 = conVarios(conQue, function () { return medir(M0.nFijos); }); } catch (e) { continue; }
          var a = armar({ p: c.p, M: M2 }, despues), r = simular(M0, a.lista);
          var tr = tcomp(r), ahorro = tBase - tr;
          if (colaModo && !despues) {
            var tm = a.lista[a.iM].t; // cuándo termina esta meta con la ayuda
            if (tm === undefined || tm > tMeta0 * (1 + A.COLA_RETRASO_PCT) + 60) { await esperar(); continue; } // atrasaría esta meta
          }
          if (ahorro > Math.max(60, isFinite(tBase) ? tBase * A.AYUDA_MIN_PCT : 0) && (!mejor || ahorro > mejor.ahorro)) mejor = { c: c, M2: M2, ahorro: ahorro, t: tr, paraCola: colaModo, despues: despues };
          await esperar();
        }
      }
      if (!mejor) break;
      elegidos.push({ type: "buildings", name: mejor.c.name, p: mejor.c.p, M: mejor.M2, motivo: "adelanta la meta", ahorro: mejor.ahorro, paraCola: mejor.paraCola, despues: mejor.despues });
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
  async function planBarcos(M, prev, tratosAhora, pMeta, faltaTi, tBase, otrosIt) {
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
      var items = prev.concat([{ p: paso.p, gana: paso.gana }]).concat(tr.map(itemTrato)).concat((otrosIt || []).map(function (x) { return Object.assign({}, x); })).concat([{ p: pMeta }]);
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
  function consumeSinSostener(b, M, siempre) {
    if (!siempre && !mantActivo()) return false;
    var ef = Object.assign({}, b.effects || {}, b.effectsCalculated || {}); // el consumo completo (effects baja a 0 si el edificio está sin insumos)
    return Object.keys(ef).some(function (k) {
      if (!/PerTick(Con)?$/.test(k) || !(ef[k] < 0)) return false;
      var r = k.replace(/PerTick(Con)?$/, ""); if (mejorJob(M, r)) return false;
      var neto = (game.getResourcePerTick(r, true) || 0) * tps();
      return neto + ef[k] * tps() < 0; // con uno más, quedaría en negativo
    });
  }
  // Recursos que tus edificios consumen, que no dependen de gatitos y que van bajando (p. ej. oil con Magnetos
  // y Calciners): agrega al principio del plan los edificios que más los suben por lo que cuestan (Oil Wells).
  function planSostener(M, avisos) {
    var pasos = []; if (!mantActivo()) return pasos;
    var soloAvisar = !esAuto(); // con una meta tuya no se agregan Oil Wells (pueden tardar horas): solo se avisa
    game.resPool.resources.forEach(function (res) {
      var r = res.name, cons = consumoPorSeg(r); if (!(cons > 0)) return;
      if (mejorJob(M, r)) return; // de esos se encargan los gatitos de mantenimiento
      var neto = (game.getResourcePerTick(r, true) || 0) * tps(); if (neto >= 0) return;
      var mejor = null;
      game.bld.buildingsData.forEach(function (b) {
        if (!b.unlocked || contamina(b.name)) return; // medioambiente: p. ej. Oil Wells; si solo hay contaminantes, se avisa
        var p = game.bld.getPrices(b.name); if (!p.length || game.resPool.isStorageLimited(p)) return;
        var sube;
        try { sube = conEdificio(b.name, function () { return (game.getResourcePerTick(r, true) || 0) * tps(); }) - neto; } catch (e) { return; }
        if (!(sube > 1e-6)) return;
        var costo = 1 + p.reduce(function (s, x) { var rr = R(x.name); return s + x.val / Math.max(1, rr.maxValue || rr.value || 1); }, 0);
        if (!mejor || sube / costo > mejor.v) mejor = { name: b.name, sube: sube, v: sube / costo };
      });
      if (!mejor) {
        if (d.on.verde && avisos) avisos.push(titulo(r) + " baja " + num(-neto) + "/s" + (res.value > 0 ? " y se acaba en ~" + tiempo(res.value / -neto) : "") + ": lo que lo sostiene contamina (p. ej. Oil Wells) y no lo compro. Los edificios que lo usan se van a parar.");
        return;
      }
      var n = Math.min(A.SOSTENER_MAX, Math.ceil(-neto / mejor.sube));
      if (soloAvisar) {
        if (avisos) avisos.push(titulo(r) + " baja " + num(-neto) + "/s" + (res.value > 0 ? " y se acaba en ~" + tiempo(res.value / -neto) : "") + ": los edificios que lo usan se van a parar. Para sostenerlo harían falta " + n + " " + etiqueta("buildings", mejor.name) + " (no los agrego a tu meta).");
        return;
      }
      for (var i = 0; i < n; i++) {
        var p = game.bld.getPrices(mejor.name, i); if (game.resPool.isStorageLimited(p)) break;
        pasos.push({ type: "buildings", name: mejor.name, p: p, motivo: "sostener", recurso: r });
      }
      anotar("Sostener: " + titulo(r) + " baja " + num(-neto) + "/s → " + n + " " + etiqueta("buildings", mejor.name) + " (+" + num(mejor.sube) + "/s c/u)");
    });
    return pasos;
  }

  // =================== MODO EDIFICIOS (después de la meta) ===================
  // ---------- medioambiente (pedido el 2026-11-19: maximizar la curación) ----------
  // cuánto cambia la pollution por tick (antes de lo que limpian las plantas) con un edificio más, con la fórmula del juego:
  // cuenta lo que produce, las Factories automatizadas (−2) y la proporción de energía limpia (Solar Farms, Hydro Plants, Reactors)
  var cachePol = {}, cachePolT = 0;
  function polucionBase() { try { return game.bld.getUndissipatedPollutionPerTick(); } catch (e) { return 0; } }
  function deltaPolucion(name) {
    if (Date.now() - cachePolT > 10000) { cachePol = {}; cachePolT = Date.now(); }
    if (name in cachePol) return cachePol[name];
    var v = 0;
    try { var b0 = polucionBase(); v = conEdificio(name, polucionBase) - b0; } catch (e) {}
    return (cachePol[name] = Math.abs(v) < 1e-9 ? 0 : v);
  }
  function contamina(name) { return !!d.on.verde && deltaPolucion(name) > 0; }
  // limpia de verdad: baja al menos LIMPIA_MIN_PCT de la pollution que entra (si no, se comprarían Solar Farms sin fin)
  function limpiaBastante(name) {
    if (!d.on.verde) return false;
    var base = polucionBase(), dl = deltaPolucion(name);
    return base > 0 && dl < 0 && -dl >= base * A.LIMPIA_MIN_PCT;
  }
  // lo que piden las investigaciones y mejoras del workshop disponibles (directo y en materias primas: science, manuscripts → culture…)
  function recursosInvestigar() {
    var listas = [], o = {};
    game.science.techs.forEach(function (t) { if (t.unlocked && !t.researched) listas.push(precios("tech", t.name)); });
    game.workshop.upgrades.forEach(function (u) { if (u.unlocked && !u.researched) listas.push(precios("upgrades", u.name)); });
    listas.forEach(function (p) { p.forEach(function (x) { o[x.name] = true; }); });
    Object.keys(faltante({}, listas)).forEach(function (r) { o[r] = true; });
    return o;
  }
  // meta general (pedido el 2026-11-19): el modo edificios solo compra lo que sirve para investigar: produce o guarda algo
  // que piden las investigaciones/mejoras, o suma gatitos. Nada que solo dé felicidad (Amphitheatre sin manuscripts pendientes…)
  function sirveInvestigar(b, nec) {
    var ef = Object.assign({}, b.effects || {}, b.effectsCalculated || {});
    if ((ef.maxKittens || 0) > 0) return true; // más gatitos: más de todo
    return Object.keys(ef).some(function (k) { return (ef[k] || 0) > 0 && Object.keys(nec).some(function (r) { return k.indexOf(r) === 0; }); });
  }
  // candidatos: edificios desbloqueados que caben en el almacenamiento, ordenados por cuánto tardan
  async function rankingEdificios() {
    var M = medirSeguro(), lista = [], nec = recursosInvestigar();
    await esperar();
    var cands = game.bld.buildingsData.filter(function (b) {
      if (!b.unlocked || A.EDIFICIOS_EXCLUIR.indexOf(b.name) >= 0 || consumeSinSostener(b, M)) return false; // p. ej. un Magneto con el oil bajando
      if (contamina(b.name)) return false; // medioambiente: nada que suba la pollution
      if (!sirveInvestigar(b, nec) && !limpiaBastante(b.name)) return false; // los que limpian siguen valiendo (opción "verde")
      var meta = game.bld.getBuildingExt(b.name).meta;
      if (meta.limitBuild && meta.val >= meta.limitBuild) return false;
      var p = game.bld.getPrices(b.name);
      return p.length && !game.resPool.isStorageLimited(p);
    });
    for (var i = 0; i < cands.length; i++) {
      var b = cands[i], p = game.bld.getPrices(b.name);
      var t = simular(M, [{ p: p }], null, null, A.EDIFICIOS_HORAS * 3600).t;
      if (isFinite(t)) lista.push({ name: b.name, label: etiqueta("buildings", b.name) + (limpiaBastante(b.name) ? " (limpia)" : ""), t: t, limpia: limpiaBastante(b.name) });
      if (i % 4 === 3) await esperar();
    }
    lista.sort(function (a, b) { return (b.limpia - a.limpia) || (a.t - b.t); }); // primero los que bajan la pollution
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
  // con "Mantener también con tus metas" (mantenerSiempre) va siempre; si no, solo en el modo edificios
  function esAuto() { return enCalculo !== null ? enCalculo : (d.plan ? !!d.plan.auto : !!d.modoEdificios); } // modo edificios
  function mantActivo() { return !!d.on.escasos && (!!d.on.mantenerSiempre || esAuto()); }
  async function calcularPlan(type, name, opts) {
    enCalculo = !!(opts && opts.auto);
    try { var P = await calcularPlan0(type, name, (opts && opts.siguientes) || []); P.auto = enCalculo; return P; } finally { enCalculo = null; }
  }
  // Las metas que siguen en la cola, para simularlas después de la primera: cada una con sus tratos por titanium.
  // Se corta en la primera que no cabe en el tope (esa se calcula al llegar, con sus edificios de almacenamiento).
  function itemsSiguientes(siguientes, previos, extraCap, M) {
    var out = [], stock = {}; game.resPool.resources.forEach(function (r) { stock[r.name] = r.value; });
    var acum = previos.slice(), tiAntes = faltante(stock, acum).titanium || 0, antes = faltante(stock, acum);
    for (var i = 0; i < siguientes.length; i++) {
      var s = siguientes[i], tf = topeFaltante(s.p);
      if (Object.keys(tf).some(function (r) { return tf[r] > ((extraCap || {})[r] || 0) + 1e-6; })) break;
      acum.push(s.p);
      // lo que esta meta suma de cosas que nadie produce (uranium…): tratos con otras razas, que piden titanium
      var ahora = faltante(stock, acum), nuevo = {};
      Object.keys(ahora).forEach(function (r) { var x = ahora[r] - (antes[r] || 0); if (x > 1e-9) nuevo[r] = x; });
      var otros = M ? pasosOtrasRazas(M, nuevo) : [];
      otros.forEach(function (x) { acum.push(x.p); });
      antes = faltante(stock, acum);
      var tiAhora = antes.titanium || 0, tiEsta = tiAhora - tiAntes; tiAntes = tiAhora;
      if (tiEsta > 0) {
        var tr = pasosComercio(tiEsta); if (!tr.length) break; // sin Zebras no se llega: se calcula al llegar
        tr.forEach(function (x) { out.push(itemTrato(x)); });
      }
      otros.forEach(function (x) { out.push(itemTrato(x)); });
      out.push({ p: s.p, meta: s.i });
    }
    return out;
  }
  async function calcularPlan0(type, name, siguientes) {
    RECETAS = {};
    var t0 = performance.now(), espera0 = 0;
    var M = medirSeguro();
    await esperar();
    var pMeta = precios(type, name);
    var alm = await planAlmacen(M, pMeta);
    // primero: edificios para que no se acabe lo que consumen tus edificios y no depende de gatitos (oil → Oil Wells)
    var avisosSost = [], sost = planSostener(M, avisosSost), nSost = sost.length; alm.pasos = sost.concat(alm.pasos);
    // titanium: lo que falta se consigue comerciando con las Zebras
    var stock0 = {}; game.resPool.resources.forEach(function (r) { stock0[r.name] = r.value; });
    // lo que nadie produce (uranium…) se compra a otras razas; su titanium se suma al de las Zebras
    var otros = pasosOtrasRazas(M, faltante(stock0, alm.pasos.map(function (s) { return s.p; }).concat([pMeta])));
    var otrosIt = otros.map(itemTrato);
    var faltaTi = faltante(stock0, alm.pasos.map(function (s) { return s.p; }).concat(otros.map(function (s) { return s.p; })).concat([pMeta])).titanium || 0;
    var tratos = pasosComercio(faltaTi);
    var itemsAlm = alm.pasos.map(function (s) { return { p: s.p, cap: s.cap }; });
    var items = itemsAlm.concat(tratos.map(itemTrato)).concat(otrosIt).concat([{ p: pMeta }]);
    var base = simular(M, items, null, null), tAhora = tcomp(base);
    var tAhoraSinNada = tAhora; // para mostrar cuánto ahorran barcos y ayudas
    // ¿conviene fabricar barcos antes de comerciar?
    var barcos = await planBarcos(M, itemsAlm, tratos, pMeta, faltaTi, tAhora, otrosIt), pasoBarcos = [];
    if (barcos) {
      tratos = barcos.tratos; pasoBarcos = [barcos.paso]; tAhora = barcos.t;
      items = itemsAlm.concat([{ p: barcos.paso.p, gana: barcos.paso.gana }])
        .concat(tratos.map(itemTrato)).concat(otrosIt).concat([{ p: pMeta }]);
    }
    // el resto de la cola: las ayudas se eligen para terminar la cola entera antes, sin atrasar esta meta
    var sig = itemsSiguientes(siguientes, items.map(function (x) { return x.p; }), alm.extra, M);
    var ayudas = await planAyudas(M, items, tAhora, sig);
    // mismo orden que la simulación: primero lo que sostiene la producción, las ayudas, almacenamiento, barcos, tratos y la meta
    // las ayudas "después" (para las metas siguientes de la cola) van tras la meta: no la atrasan
    var ayA = ayudas.filter(function (a) { return !a.despues; }), ayD = ayudas.filter(function (a) { return a.despues; });
    var pasos = alm.pasos.slice(0, nSost).concat(ayA).concat(alm.pasos.slice(nSost)).concat(pasoBarcos).concat(tratos).concat(otros).concat([{ type: type, name: name, p: pMeta, motivo: "meta" }]).concat(ayD);
    // simulación final con todo (hasta la meta: su tiempo es el que se muestra)
    var itemsF = items.slice(0, nSost).concat(ayA.map(function (a) { return { p: a.p, M: a.M }; })).concat(items.slice(nSost));
    // festival: ¿la cola entera (esta meta, sus ayudas "después" y las siguientes) termina antes con uno ahora?
    await esperar();
    var itemsD = ayD.map(function (a) { return { p: a.p, M: a.M }; });
    var fest = evaluarFestival(M, itemsF.concat(itemsD).concat(sig));
    if (fest && fest.conviene) { itemsF = [Object.assign({}, fest.item)].concat(itemsF); pasos.unshift(pasoFestival(fest)); }
    var fin = (ayA.length || barcos || nSost || (fest && fest.conviene)) ? simular(M, itemsF) : base;
    itemsF = itemsF.concat(itemsD);
    // tiempos de las metas siguientes, haciendo la cola en orden (desde ahora)
    var tCola = {};
    if (sig.length) {
      var itemsQ = itemsF.map(function (x) { return Object.assign({}, x); }).concat(sig.map(function (x) { return Object.assign({}, x); }));
      var rq = simular(M, itemsQ);
      itemsQ.forEach(function (x) { if (x.meta !== undefined && x.t !== undefined) tCola[x.meta] = Math.max(1, x.t); });
      if (!isFinite(rq.t) && isFinite(rq.tEst)) { var ultQ = sig[sig.length - 1]; if (tCola[ultQ.meta] === undefined) tCola[ultQ.meta] = { est: rq.tEst }; }
    }
    // tiempos por recurso (con todos los libres en su mejor oficio)
    var stock = {}; game.resPool.resources.forEach(function (r) { stock[r.name] = r.value; });
    var falta = faltante(stock, pasos.map(function (p) { return p.reales || p.p; })), porRec = [];
    delete falta.titanium; // va por comercio
    Object.keys(falta).forEach(function (r) {
      var j = mejorJob(M, r), b = M.base[r] || 0, conJ = j ? b + M.m[j][r] * M.N : b, conv = null;
      if (r === "manpower") { // en M el catpower de los hunters figura ya cazado (como furs): se usa lo que juntan sin cazar
        j = Object.keys(M.mpCrudo || {}).sort(function (a, b2) { return M.mpCrudo[b2] - M.mpCrudo[a]; })[0] || null;
        conJ = j ? b + M.mpCrudo[j] * M.N - (consumoConv(M).manpower || 0) : b; // menos lo que se comen las Mints
      }
      if (!j) M.conv.forEach(function (c) { if (c.outs[r] > 0) { conv = (conv ? conv + " y " : "") + etiqueta("buildings", c.nombre); conJ += c.outs[r]; } }); // todos los que lo producen (Smelters + Calciners)
      porRec.push({ r: r, falta: falta[r], job: j, conv: conv, t: conJ > 0 ? falta[r] / conJ : Infinity, solo: !j && !conv });
    });
    porRec.sort(function (a, b) { return b.t - a.t; });
    // edificios apagados que producen algo que el plan necesita (p. ej. Smelters apagados: no entra iron)
    var avisos = avisosSost.slice();
    game.bld.buildingsData.forEach(function (b) {
      if (!b.val || typeof b.on !== "number" || b.on >= b.val) return;
      var ef = Object.assign({}, b.effects || {}, b.effectsCalculated || {}), da = {};
      Object.keys(ef).forEach(function (k) {
        var m = /^(.+?)(PerTickAutoprod|PerTickBase|PerTickProd|PerTick|Ratio)$/.exec(k);
        if (m && ef[k] > 0 && falta[m[1]] > 0) da[m[1]] = true;
      });
      if (Object.keys(da).length) avisos.push("Tienes " + (b.val - b.on) + " " + etiqueta("buildings", b.name) + " apagados, y producen " + Object.keys(da).map(titulo).join(", ") +
        ", que este plan necesita. Si los enciendes y vuelves a calcular, el plan cambia.");
    });
    var z = zebras();
    return {
      type: type, name: name, label: etiqueta(type, name), pasos: pasos, M: M, sim: fin, sinAyuda: tAhoraSinNada, avisos: avisos,
      festival: fest, festItem: fest && fest.conviene ? fest.item : null, sigItems: sig, revisadoFest: Date.now(),
      porRec: porRec, imposible: alm.imposible, ms: Math.round(performance.now() - t0),
      tratos: tratos.reduce(function (a, s) { return a + s.k; }, 0), faltaTi: faltaTi, zebras: z,
      sinZebras: faltaTi > 0 && !tratos.length, tCola: tCola, nSig: sig.filter(function (x) { return x.meta !== undefined; }).length
    };
  }

  // =================== EJECUCIÓN ===================
  function reservas(sinCola) { // lo que el plan necesita (y los insumos de los edificios que consumen): nadie más debe gastarlo
    var o = colchones();
    if (!d.plan || !d.ejecutando) return o;
    // lo ya fabricado cuenta (si el steel está hecho, no se reserva coal ni iron para hacerlo de nuevo);
    // las materias primas, en cero: así se reserva todo lo que el plan va a gastar de ellas
    var stock = {}; game.resPool.resources.forEach(function (r) { stock[r.name] = esFab(r.name) ? r.value : 0; });
    function reales(p) { return p.reales || p.p; }
    d.plan.pasos.forEach(function (p) { reales(p).forEach(function (x) { o[x.name] = (o[x.name] || 0) + x.val; }); });
    var bruto = faltante(stock, d.plan.pasos.map(reales));
    Object.keys(bruto).forEach(function (r) { o[r] = Math.max(o[r] || 0, bruto[r]); });
    // lo ya fabricado para las metas siguientes de la cola (plates, steel…) tampoco se gasta en otra cosa
    var fc = sinCola ? {} : fabricadosCola();
    Object.keys(fc).forEach(function (r) { o[r] = (o[r] || 0) + Math.min(fc[r], Math.max(0, R(r).value - (o[r] || 0))); });
    return o;
  }
  // lo fabricado (no materias primas) que piden las metas siguientes de la cola
  function fabricadosCola() {
    // con la meta ya comprada (quedan sus ayudas "después"), la cola ya la sacó: la siguiente es la primera
    var o = {}, desde = d.plan && d.plan.metaHecha ? 0 : 1; if (!d.plan || !d.plan.deCola || d.cola.length <= desde) return o;
    preciosCola(desde).forEach(function (p) { p.forEach(function (x) { if (esFab(x.name)) o[x.name] = (o[x.name] || 0) + x.val; }); });
    return o;
  }
  // Cola: mientras se trabaja en la meta actual, fabrica lo que piden las siguientes con lo que está por llenarse
  // (iron casi lleno → plates para la última), sin bajar el insumo de PREFAB_DEJAR_PCT ni tocar lo que reserva la meta actual.
  function prefabricarCola(res) {
    var fc = fabricadosCola(), hecho = [], resMeta = reservas(true);
    Object.keys(fc).forEach(function (n) {
      var falta = fc[n] - Math.max(0, R(n).value - (resMeta[n] || 0)); // lo que ya hay, después de lo que pide la meta actual
      if (falta <= 0) return;
      var c = game.workshop.getCraft(n); if (!c || !c.unlocked) return;
      var resP = Object.assign({}, res), sirve = true;
      game.workshop.getCraftPrice(c).forEach(function (x) {
        var r = R(x.name);
        if (esFab(x.name)) { resP[x.name] = Math.max(resP[x.name] || 0, resMeta[x.name] || 0); return; } // lo fabricado se usa si sobra (nunca lo de la meta actual)
        if (!(r.maxValue > 0) || r.value < r.maxValue * A.PREFAB_PCT) { sirve = false; return; } // solo con lo que se va a desbordar
        resP[x.name] = Math.max(resP[x.name] || 0, r.maxValue * A.PREFAB_DEJAR_PCT);
      });
      if (!sirve) return;
      var rinde = (rec(n) || { rinde: 1 }).rinde || 1, antes = R(n).value;
      if (fabricar(n, Math.ceil(falta / rinde), resP)) hecho.push(num(R(n).value - antes) + " " + titulo(n));
    });
    if (hecho.length) anotar("Cola: fabriqué " + hecho.join(", ") + " para las metas siguientes");
  }
  function libre(n, res) { return R(n).value - ((res || {})[n] || 0); }
  // cuánto de un fabricado (p. ej. steel) le falta todavía a la meta actual, contando lo que ya hay.
  // Solo la meta actual: con la cola, fabricar concrete para las metas siguientes liberaba las slabs
  // reservadas para la Mansion en curso y nunca la compraba (2026-11-19).
  function pidePlan(n) {
    if (!d.plan || !d.ejecutando) return 0;
    var listas = d.plan.pasos.map(function (p) { return p.reales || p.p; });
    var pool = {}, dem = 0;
    function pedir(x, cant, nivel) {
      if (cant <= 1e-9 || nivel > 8) return;
      var hay = x in pool ? pool[x] : R(x).value, usa = Math.min(hay, cant); pool[x] = hay - usa; cant -= usa;
      if (cant <= 1e-9) return;
      if (x === n) { dem += cant; return; }
      if (esFab(x)) { var r = rec(x), veces = Math.ceil(cant / r.rinde - 1e-6); Object.keys(r.porVez).forEach(function (q) { pedir(q, r.porVez[q] * veces, nivel + 1); }); }
    }
    listas.forEach(function (p) { (p || []).forEach(function (x) { pedir(x.name, x.val, 0); }); });
    return dem;
  }
  function fabricar(nombre, max, res) {
    var c = game.workshop.getCraft(nombre); if (!c || !c.unlocked) return 0;
    var n = max, precio = game.workshop.getCraftPrice(c), rc = rec(nombre);
    // lo que el plan reserva para hacer este mismo fabricado (coal e iron para su steel) sí se puede usar para hacerlo:
    // fabricarlo antes no le quita nada al plan (antes el coal se llenaba sin hacer steel)
    var paraPlan = rc ? Math.ceil(pidePlan(nombre) / rc.rinde - 1e-6) : 0;
    if (paraPlan > 0 && res) {
      var col = colchones(); res = Object.assign({}, res);
      precio.forEach(function (p) { res[p.name] = Math.max(col[p.name] || 0, (res[p.name] || 0) - p.val * paraPlan); });
    }
    precio.forEach(function (p) { n = Math.min(n, Math.floor(libre(p.name, res) / p.val)); });
    if (!isFinite(n) || n < 1) return 0;
    return craftear(nombre, n);
  }
  // fabrica en cadena hacia los precios del paso actual
  function fabricarHacia(p) {
    var reservaFab = colchones(); // tampoco fabrica gastando los insumos de Smelters, Magnetos, etc.
    reservaFab.furs = (reservaFab.furs || 0) + A.RESERVA_FURS; // ni los furs que siempre se dejan (antes un paso con parchment los dejaba en 0)
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
    d.ritmoTratos = esAuto() ? slabsParaTratos(M) : {}; // lo que se junta por segundo para los slabs de los tratos (modo edificios)
    var stock = {}; game.resPool.resources.forEach(function (r) { stock[r.name] = r.value; });
    var despues = d.plan.pasos.slice(1).map(function (p) { return p.p; }).concat(!d.plan.deCola ? [] : d.plan.metaHecha ? preciosCola(0) : d.cola.length > 1 ? preciosCola(1) : []);
    var p0 = d.plan.pasos[0].p;
    if (d.plan.pasos[0].reales && d.plan.pasos[0].reales.some(function (x) { return x.name === "manpower"; })) { // tratos y festival
      // en un trato, p cuenta su catpower como los furs que se dejan de cazar: con furs guardados parecía cubierto,
      // nadie cazaba y el catpower quedaba en 10 (pasó el 2026-11-19, 7 tratos trabados). Ahora pide lo que de verdad falta.
      var mpPide = (d.plan.pasos[0].reales.filter(function (x) { return x.name === "manpower"; })[0] || { val: 0 }).val;
      var mpFalta = Math.max(0, Math.min(mpPide, (R("manpower").maxValue || Infinity) * 0.9) - R("manpower").value), czA = caza();
      p0 = p0.filter(function (x) { return x.name !== "furs"; });
      if (mpFalta > 0) p0.push({ name: "furs", val: (R("furs").value || 0) + mpFalta / czA.costo * czA.furs });
    }
    var a = politica(M, stock, [p0], d.jobActual, despues);
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
      if (!d.plan.metaHecha) { anotar((d.plan.auto ? "Edificios: listo " : "¡Meta cumplida: ") + d.plan.label + (d.plan.auto ? "" : "!")); registrarResultado(); }
      if (d.plan.deCola && d.cola.length && !d.plan.metaHecha) { d.cola.shift(); d.colaEst = null; d.colaTotal = null; }
      if (d.colaActiva && !d.cola.length) { d.colaActiva = false; anotar("Cola terminada"); }
      // sigue con la cola; si no hay, con el edificio que tarde menos
      if (!d.colaActiva && d.on.edificios) { d.modoEdificios = true; ultimaBusqueda = -999; }
      d.ejecutando = false; d.plan = null; guardar(); return;
    }
    if (p.type === "trade") { comerciar(p); }
    else if (p.type === "festival") {
      if (!festivalDisponible()) { anotar("Festival: ya hay uno en curso"); terminarPaso(); ultimoReparto = -999; }
      else {
        var colF = colchones(), resFe = Object.assign({}, colF); resFe.furs = (colF.furs || 0) + A.RESERVA_FURS; // el parchment sale de los furs, dejando la reserva
        if (festival(resFe)) { terminarPaso(); ultimoReparto = -999; d.reestimar = true; guardar(); }
      }
    }
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
    { // si falta titanium (los tratos dieron menos, o una ayuda lo pide), agrega tratos con las Zebras
      var st0 = {}; game.resPool.resources.forEach(function (r) { st0[r.name] = r.value; });
      var fti = faltante(st0, [precios(p.type, p.name)]).titanium || 0, extra = fti > 0 ? pasosComercio(fti) : [];
      if (extra.length) { d.plan.pasos = extra.concat(d.plan.pasos); anotar("Faltan " + num(fti) + " de titanium: agrego " + extra.reduce(function (a, s) { return a + s.k; }, 0) + " tratos con las Zebras"); return; }
    }
    p.p = precios(p.type, p.name); // precio actualizado
    fabricarHacia(p.p);
    var col = colchones(); // no deja sin insumos a Smelters, Magnetos, etc.
    if (p.p.every(function (x) { return R(x.name).value >= x.val + colPara(col, x, R(x.name).maxValue || Infinity); })) {
      if (comprar(p.type, p.name)) {
        anotar("Compré " + etiqueta(p.type, p.name) + (p.motivo !== "meta" ? " (" + (p.despues ? "para las metas siguientes" : p.motivo) + ")" : ""));
        terminarPaso(); ultimoReparto = -999;
        if (p.motivo === "meta" && d.plan.pasos.length) { // quedan las ayudas para la cola: la meta ya está
          d.plan.metaHecha = true; anotar("¡Meta cumplida: " + d.plan.label + "! Ahora lo que acelera las siguientes"); registrarResultado();
          if (d.plan.deCola && d.cola.length) { d.cola.shift(); d.colaEst = null; d.colaTotal = null; } // ya no está pendiente
        }
        guardar();
      }
    }
    }
    if (segundos - ultimoReparto >= A.REPLANEAR_SEG) { ultimoReparto = segundos; aplicarReparto(); }
  }

  // ---------- pasos: hechos, actual y su avance ----------
  function textoPaso(p) {
    if (p.type === "trade") return "Comerciar " + (p.k > 0 ? p.k : (p.kHechos || 0)) + " veces con " + nombreRaza(p.name || "zebras") + " <span style='color:#9aa3b2'>(" + textoGana(p) + ")</span>";
    if (p.type === "festival") return "Festival <span style='color:#7fd19b'>(" + textoAhorro(p.ahorro) + " en la cola; dura 1 año)</span>";
    if (p.type === "ship") {
      var rinde = (rec("ship") || { rinde: 1 }).rinde, zb = zebras(p.veces * rinde);
      return "Fabricar ~" + Math.round(p.veces * rinde) + " barcos <span style='color:#7fd19b'>(" + textoAhorro(p.ahorro || 0) + ")</span>" +
        (zb ? " <span style='color:#9aa3b2'>→ ~" + num(zb.ti) + " titanium por trato</span>" : "");
    }
    return (p.motivo === "meta" ? "<b>" + etiqueta(p.type, p.name) + "</b>" : "Construir " + etiqueta(p.type, p.name)) +
      (p.motivo === "almacenamiento" ? " <span style='color:#e0b050'>(falta tope)</span>" : "") +
      (p.motivo === "sostener" ? " <span style='color:#e0b050'>(para no quedarte sin " + titulo(p.recurso) + ")</span>" : "") +
      (p.motivo === "adelanta la meta" ? " <span style='color:#7fd19b'>(" + textoAhorro(p.ahorro) + (p.paraCola ? " en la cola" : "") + (p.despues ? "; después de la meta, no la atrasa" : "") + ")</span>" : "");
  }
  function terminarPaso() {
    var p = d.plan.pasos.shift(); if (!p) return;
    (d.plan.hechos = d.plan.hechos || []).push({ texto: textoPaso(p).replace(/<[^>]+>/g, ""), t: Date.now() });
    d.jobActual = null; d.etapaActual = null; d.reestimar = true; // la etapa siguiente se elige de cero
  }
  // cuánto tienes de lo que pide un paso (los fabricados se cuentan en materias primas)
  // ---------- atascos (pedido el 2026-11-19): si el paso no avanza en ATASCO_SEG, avisa lo que falta según el juego y recalcula ----------
  // lo que falta según el juego: lo que pide el paso, lo que tienes y lo que entra por segundo (como la pestaña del edificio)
  function faltaJuego(p) {
    var pr = p.reales || p.p, partes = [];
    (pr || []).forEach(function (x) {
      var r = R(x.name); if (!r || r.value >= x.val - 1e-6) return;
      var por = (game.getResourcePerTick(x.name, true) || 0) * tps(), falta = x.val - r.value;
      partes.push(titulo(x.name) + " " + num(r.value) + " / " + num(x.val) + " (" +
        (r.maxValue > 0 && x.val > r.maxValue ? "no cabe: tope " + num(r.maxValue) : esFab(x.name) && !(por > 1e-9) ? "se fabrica con " + Object.keys(rec(x.name).porVez).map(titulo).join(" + ") : por > 1e-9 ? "+" + num(por) + "/s → " + tiempo(falta / por) : por < -1e-9 ? "baja " + num(-por) + "/s" : "no se produce") + ")");
    });
    return partes.join(" · ");
  }
  var atasco = { paso: null, mejor: -1, desde: 0, recalc: -1e9 };
  function vigilarAtasco() {
    if (!d.plan || !d.ejecutando || d.pausa || calculando || !d.plan.pasos.length) { atasco.paso = null; return; }
    var p = d.plan.pasos[0], av = avancePaso(p);
    var pct = av.length ? av.reduce(function (s, x) { return s + x.pct; }, 0) / av.length : 1;
    if (p.type === "trade") pct += (p.kHechos || 0) * 1e-3; // cada trato hecho cuenta como avance
    if (p.type === "ship") pct -= (p.veces || 0) * 1e-3;
    var clave = p.type + "|" + p.name;
    if (atasco.paso !== p) { // paso nuevo; si es el mismo recalculado (tras el aviso), el aviso queda a la vista hasta que avance
      var mismo = atasco.clave === clave; atasco.paso = p; atasco.clave = clave; atasco.mejor = pct;
      if (!mismo) { atasco.desde = segundos; d.atasco = null; }
      return;
    }
    if (pct > atasco.mejor + 0.001) { // avanzó: todo bien
      atasco.mejor = pct; atasco.desde = segundos; atasco.recalcClave = null;
      if (d.atasco) { d.atasco = null; anotar("El paso volvió a avanzar"); }
      return;
    }
    if (segundos - atasco.desde < A.ATASCO_SEG) return;
    var falta = faltaJuego(p), quien = sinHtml(textoPaso(p));
    d.atasco = "Trabado hace " + tiempo(segundos - atasco.desde) + ": " + quien + (falta ? ". Según el juego falta: " + falta : ". Según el juego no falta nada: no pude comprarlo");
    atasco.desde = segundos; // vuelve a mirar en otro ATASCO_SEG
    anotar("⚠ " + d.atasco);
    // ya se recalculó por este mismo paso y sigue trabado: pasa a la meta siguiente de la cola (pedido el 2026-11-19);
    // esta queda segunda y se vuelve a intentar después
    if (atasco.recalcClave === clave && d.plan.deCola && !d.plan.metaHecha && d.cola.length > 1) {
      var trabada = d.cola.splice(0, 1)[0]; d.cola.splice(1, 0, trabada);
      atasco.recalcClave = null; atasco.recalc = segundos;
      anotar("Paso a " + d.cola[0].label + "; " + trabada.label + " queda después (sigue trabada)");
      d.plan = null; d.ejecutando = false; // el bucle arranca la meta siguiente de la cola (siguienteDeCola)
      guardar(); return;
    }
    if (segundos - atasco.recalc >= A.ATASCO_RECALC_SEG) {
      atasco.recalcClave = clave; // recalcula (como mucho una vez cada 10 min, para no quedar en un bucle)
      atasco.recalc = segundos; anotar("Recalculo el plan por el atasco");
      recalcular().then(function () { atasco.paso = null; guardar(); vista = pintarPlan(); pintar(); })
        .catch(function (e) { console.error(e); anotar("No pude recalcular: " + e.message); });
    }
  }
  function avancePaso(p) {
    var pr = p.reales || p.p; if (!pr || !pr.length) return [];
    var stock = {}; game.resPool.resources.forEach(function (r) { stock[r.name] = r.value; });
    var tot = faltante({}, [pr]), fal = faltante(sinCol(stock, colchones()), [pr]);
    return Object.keys(tot).map(function (r) { return { r: r, pct: Math.max(0, Math.min(1, 1 - (fal[r] || 0) / tot[r])), falta: fal[r] || 0 }; })
      .sort(function (a, b) { return a.pct - b.pct; });
  }
  function barra(pct) {
    return "<span style='display:inline-block;width:80px;height:7px;background:#2a2f3a;border-radius:4px;vertical-align:middle;margin-right:4px'>" +
      "<span style='display:block;height:7px;width:" + Math.round(pct * 100) + "%;background:#7fd19b;border-radius:4px'></span></span>";
  }
  // ---------- panel: piezas reutilizables ----------
  function attr(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function sinHtml(s) { return String(s || "").replace(/<[^>]+>/g, ""); }
  // sección que se despliega con un clic (recuerda si quedó abierta)
  function det(k, tt, inner, defOpen, estilo, tip) {
    var open = k in abiertos ? abiertos[k] : defOpen;
    return "<details data-det='" + k + "' style='margin-top:6px'" + (open ? " open" : "") + "><summary" + (tip ? " title=\"" + attr(tip) + "\"" : "") + " style='cursor:pointer" + (estilo ? ";" + estilo : "") + "'><b>" + tt + "</b></summary>" +
      "<div style='margin:2px 0 0 12px'>" + inner + "</div></details>";
  }
  function textoEtapas(P, i) {
    var et = P.sim.etapas || [];
    return et.filter(function (e) { return e.paso === i; }).map(function (e) {
      var sig = et[et.indexOf(e) + 1], fin = sig ? sig.desde : P.sim.t;
      return "• " + (JT[e.job] || e.job) + (e.recurso ? " (" + titulo(e.recurso) + ")" : "") + ": " + tiempo(e.desde).replace("ya", "0 min") + " → " + tiempo(fin);
    }).join("\n");
  }
  function htmlPasos(P) {
    var h = "", hechos = P.hechos || [];
    if (hechos.length) h += det("hechos", "✓ Hechos (" + hechos.length + ")", hechos.slice(-10).map(function (x) {
      return "<div style='color:#7fd19b'>✓ " + x.texto + " <span style='color:#9aa3b2'>(" + hora(x.t) + ")</span></div>";
    }).join(""), false, "color:#7fd19b;font-size:11.5px");
    var filas = P.pasos.map(function (p, i) {
      var actual = i === 0 && d.ejecutando, et = textoEtapas(P, i);
      var tip = sinHtml(textoPaso(p)) + (et ? "\n\nEtapas (todos los libres a un oficio a la vez):\n" + et : "");
      var f = "<div title=\"" + attr(tip) + "\" style='margin-top:2px;cursor:help" + (actual ? ";color:#fff" : "") + "'>" +
        (actual ? "▶ " : "<span style='color:#9aa3b2'>" + (i + 1) + ".</span> ") + cortoPaso(p) + "</div>";
      if (actual) f += progresoPaso(p, 14);
      return f;
    });
    // un solo paso (la meta): sin lista, solo la barra (el nombre ya está arriba y en la cola)
    if (P.pasos.length === 1 && P.pasos[0].motivo === "meta" && !hechos.length) return d.ejecutando ? progresoPaso(P.pasos[0], 0) : "";
    var MAX = 5;
    h += filas.slice(0, MAX).join("");
    if (filas.length > MAX) h += det("pasosMas", (filas.length - MAX) + " más", filas.slice(MAX).join(""), false, "color:#9aa3b2;font-size:11.5px");
    return det("pasos", "Pasos (" + P.pasos.length + ")", h, true, "", "Pasa el mouse sobre un paso para ver el detalle y sus etapas");
  }
  // barra de avance del paso actual y a qué oficio van los libres (el detalle por recurso, en el tooltip)
  function progresoPaso(p, margen) {
    var av = avancePaso(p), tot = av.length ? av.reduce(function (s, x) { return s + x.pct; }, 0) / av.length : 1, ea = d.etapaActual;
    var tipAv = av.map(function (x) { return titulo(x.r) + ": " + Math.round(x.pct * 100) + " %" + (x.falta > 0 ? " (faltan " + num(x.falta) + ")" : ""); }).join("\n") +
      (p.type === "trade" ? "\nFaltan " + p.k + " tratos" : p.type === "ship" ? "\nFaltan " + p.veces + " fabricaciones" : "") +
      (ea && ea.job ? "\nTodos los libres a " + (JT[ea.job] || ea.job) + (ea.recurso ? ", juntando " + titulo(ea.recurso) : "") : "");
    return "<div title=\"" + attr(tipAv) + "\" style='font-size:11.5px;margin-left:" + margen + "px;cursor:help;color:#c8cdd6'>" + barra(tot) + Math.round(tot * 100) + " %" +
      (ea && ea.job ? " · " + (JT[ea.job] || ea.job) + (ea.recurso ? " (" + titulo(ea.recurso) + ")" : "") : "") + "</div>";
  }
  // un paso en pocas palabras (el detalle va en el tooltip, con textoPaso)
  function cortoPaso(p) {
    var g = function (t) { return " <span style='color:#9aa3b2;font-size:11.5px'>" + t + "</span>"; };
    if (p.type === "trade") return nombreRaza(p.name || "zebras") + " ×" + (p.k > 0 ? p.k : (p.kHechos || 0)) + g(textoGana(p));
    if (p.type === "ship") return "Barcos ×" + Math.round(p.veces * ((rec("ship") || { rinde: 1 }).rinde)) + (p.ahorro > 0 ? g("−" + tiempo(p.ahorro)) : "");
    if (p.type === "festival") return "Festival" + g(isFinite(p.ahorro) ? "−" + tiempo(p.ahorro) : "");
    var n = etiqueta(p.type, p.name);
    if (p.motivo === "meta") return "<b>" + n + "</b>";
    if (p.motivo === "almacenamiento") return n + g("tope");
    if (p.motivo === "sostener") return n + g(titulo(p.recurso));
    if (p.motivo === "adelanta la meta") return n + g((isFinite(p.ahorro) ? "−" + tiempo(p.ahorro) : "necesario") + (p.despues ? ", después" : ""));
    return n;
  }
  // un aviso largo en una línea: hasta los dos puntos; el texto completo, en el tooltip
  function avisoCorto(txt, color) {
    var plano = sinHtml(txt), i = plano.indexOf(": "), corto = i > 0 && i < 90 ? plano.slice(0, i) : plano.length > 90 ? plano.slice(0, 87) + "…" : plano;
    return "<div title=\"" + attr(plano) + "\" style='color:" + color + ";font-size:12px;margin-top:3px;cursor:help;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'>⚠ " + attr(corto) + "</div>";
  }

  // ---------- estimado vs real ----------
  function empezarCronometro() {
    if (!d.plan) return;
    d.plan.inicio = Date.now(); d.plan.estimado = tcomp(d.plan.sim); d.plan.pausado = 0; d.plan.pausaDesde = null; marcarSim(d.plan);
  }
  // cuenta regresiva: lo que estimó la última simulación menos lo que pasó desde entonces (sin contar pausas)
  function marcarSim(P) { P.simDesde = Date.now(); P.simPausado = P.pausado || 0; }
  function restante(P) {
    var t = tcomp(P.sim); if (!isFinite(t)) return t;
    if (!P.simDesde) marcarSim(P);
    var ahora = d.pausa && P.pausaDesde ? P.pausaDesde : Date.now();
    return t - (ahora - P.simDesde - ((P.pausado || 0) - (P.simPausado || 0))) / 1000;
  }
  function textoRestante(P) {
    if (!d.ejecutando || !isFinite(tcomp(P.sim))) return tiempoPlan(P.sim);
    var r = restante(P);
    if (r <= 0) { if (Date.now() - (P.reestimadoEn || 0) > 30000) d.reestimar = true; return "ya casi (recalculando)"; }
    return "quedan " + (isFinite(P.sim.t) ? "" : "unas ") + tiempoSeg(r);
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
    game.updateCaches(); topes(); // el juego sube los topes recién en su próximo tick: sin esto, tras comprar un edificio de almacenamiento decía "no cabe"
    var iMeta = -1; P.pasos.forEach(function (p, i) { if (iMeta < 0 && p.motivo === "meta") iMeta = i; });
    var items = (iMeta >= 0 ? P.pasos.slice(0, iMeta + 1) : P.pasos).map(function (p) { // el tiempo es hasta la meta (las ayudas para la cola van después)
      if (p.type === "trade") return itemTrato(p);
      if (p.type === "festival") return P.festItem ? Object.assign({}, P.festItem) : { p: p.p };
      return { p: p.p, cap: p.cap, gana: p.gana, M: p.M };
    });
    var M = medirSeguro();
    // festival: cuando termina el del año (o al principio no convenía), cada 5 min vuelve a ver si uno ahora acorta la cola
    if (d.on.festival && !P.metaHecha && iMeta >= 0 && Date.now() - (P.revisadoFest || 0) >= 600000 && festivalDisponible() && !P.pasos.some(function (p) { return p.type === "festival"; })) {
      var resto = P.pasos.slice(iMeta + 1).map(function (p) { return { p: p.p, M: p.M }; }); // ayudas "después"
      var ev = evaluarFestival(M, items.concat(resto).concat(P.sigItems || []));
      P.festival = ev; P.revisadoFest = Date.now();
      if (ev && ev.conviene) {
        P.pasos.unshift(pasoFestival(ev)); P.festItem = ev.item; items.unshift(Object.assign({}, ev.item));
        d.jobActual = null; ultimoReparto = -999;
        anotar("Festival: uno ahora " + textoAhorro(ev.ahorro) + " en la cola; lo agrego al plan");
      }
    }
    P.sim = simular(M, items);
    P.reestimadoEn = Date.now(); marcarSim(P);
  }

  function comerciar(p) {
    var race = game.diplomacy.get(p.name || "zebras"); if (!race || !race.unlocked) return;
    fabricarHacia(p.reales); // slabs
    var dip = game.diplomacy, max = dip.getMaxTradeAmt(race) || 0, n = Math.min(p.k, max);
    if (n < 1) {
      // otra raza que cobra en titanium (Dragons) y no alcanza (las Zebras dieron menos): más tratos con las Zebras antes
      var ti = (p.reales || []).filter(function (x) { return x.name === "titanium"; })[0];
      var faltaT = ti && race.name !== "zebras" ? ti.val / Math.max(1, p.k) - R("titanium").value : 0;
      if (faltaT > 0) {
        var extra = pasosComercio(ti.val - R("titanium").value);
        if (extra.length) { d.plan.pasos = extra.concat(d.plan.pasos); anotar("Faltan " + num(ti.val - R("titanium").value) + " de titanium para " + nombreRaza(race.name) + ": agrego " + extra.reduce(function (a, s) { return a + s.k; }, 0) + " tratos con las Zebras"); }
      }
      return;
    }
    var antes = {}; Object.keys(p.gana || {}).forEach(function (r) { antes[r] = R(r).value; });
    dip.tradeMultiple(race, n);
    var queda = (p.k - n) / p.k; // lo que pide el paso baja con los tratos hechos (si no, reservaba gold y catpower de más)
    ["reales", "p"].forEach(function (k) { p[k] = p[k].map(function (x) { return { name: x.name, val: x.val * queda }; }); });
    var gano = Object.keys(antes).map(function (r) { return "+" + num(R(r).value - antes[r]) + " " + titulo(r); }).join(", ");
    if (p.gana) Object.keys(p.gana).forEach(function (r) { p.gana[r] *= queda; });
    p.k -= n; p.kHechos = (p.kHechos || 0) + n; sumar("tratos", n); if ("titanium" in antes) sumar("titanium", R("titanium").value - antes.titanium);
    anotar("Comercié " + n + " veces con " + race.title + ": " + (gano || "nada"));
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
  // si el catnip se va a acabar en menos de 2 min, avisa y (con un plan en marcha) reparte ya: medirSeguro suma farmers
  var avisoCatnip = -999;
  function vigilarCatnip() {
    var c = R("catnip"), net = (game.getResourcePerTick("catnip", true) || 0) * tps();
    d.catnipAlerta = null;
    if (!(net < 0) || c.value / -net > 120) return;
    d.catnipAlerta = "El catnip se acaba en ~" + tiempo(c.value / -net) + (d.plan && d.ejecutando ? ": sumando farmers" : ": pon más farmers");
    if (d.plan && d.ejecutando && segundos - ultimoReparto > 10) ultimoReparto = -999;
    if (segundos - avisoCatnip >= 60) {
      avisoCatnip = segundos;
      anotar("⚠ El catnip se acaba en ~" + tiempo(c.value / -net) + " (" + num(net) + "/s)" + (d.plan && d.ejecutando ? ": sumo farmers" : ": pon más farmers o los gatitos se mueren de hambre"));
    }
  }
  // el oil que se desborda va a plastic (pedido el 2026-11-19); si todavía no se puede fabricar plastic, a kerosene
  function delOil() { return rec("plastic") ? "plastic" : "kerosene"; }
  function automaticos() {
    var res = reservas(), necesitaCaza = !!(res.furs || res.ivory || res.parchment || res.manuscript || res.compedium);
    var resF = Object.assign({}, res); resF.furs = (res.furs || 0) + A.RESERVA_FURS; // furs: siempre deja una reserva
    vigilarApagados();
    vigilarCatnip();
    if (d.on.cielo && game.calendar.observeBtn) { var b = document.querySelector("#observeButton input"); if (b) b.click(); else game.calendar.observeHandler(); sumar("cielo", 1); }
    if (d.on.refinar && lleno("catnip", 0.99)) fabricar("wood", 5); // refina de a 5: el catnip queda cerca del 99 % (en invierno aguanta con lo guardado)
    var fest = d.on.festival ? festivalQuiere(res) : null;
    if (fest && fest.listo) festival(resF);
    var pasoTrato = d.ejecutando && d.plan && d.plan.pasos[0] && d.plan.pasos[0].type === "trade";
    if (d.on.oroTitanio && mantActivo() && d.ritmoTratos) { // la cuenta aparte crece con lo que juntan los miners extra (hasta 1 h)
      d.cuentaTratos = d.cuentaTratos || {};
      Object.keys(d.ritmoTratos).forEach(function (q) { d.cuentaTratos[q] = Math.min(d.ritmoTratos[q] * 3600, (d.cuentaTratos[q] || 0) + d.ritmoTratos[q]); });
    }
    if (d.on.lider && segundos % 10 === 5) ascenderLider(res); // antes que los tratos: el gold primero va al líder
    if (d.on.oroTitanio && !pasoTrato) oroATitanio(res); // antes de cazar, para que quede catpower
    if (d.on.cazar && (lleno("manpower", 0.99) || (necesitaCaza && d.ejecutando))) {
      var reservaCaza = A.RESERVA_CAZA + (pasoTrato ? (zebras() || { catpower: 50 }).catpower * Math.min(d.plan.pasos[0].k, 50) : 0);
      var pasoFest = d.ejecutando && d.plan && d.plan.pasos[0] && d.plan.pasos[0].type === "festival";
      if (fest || pasoFest) reservaCaza = Math.max(reservaCaza, FESTIVAL.manpower); // guarda el catpower del festival
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
    if (segundos % 10 === 0) { fursHist.push(R("furs").value); if (fursHist.length > 31) fursHist.shift(); }
    if (d.on.manuscript && lleno("culture", A.CULTURA_PCT) && !fest) gastarCultura(resF);
    if (d.on.oportunidad && segundos % 10 === 0) oportunidad(res);
    if (d.on.escasos && segundos % 10 === 3) encenderConsumidores();
    if (d.on.steel && segundos % A.STEEL_CADA_SEG === 0) fabricar("steel", Infinity, res);
    if (d.plan && d.plan.deCola && d.ejecutando && !d.pausa && segundos % 5 === 2) prefabricarCola(res);
    if (d.on.bsp) {
      // Lo que se transforma no debe llegar al tope: si en ANTES_TOPE_SEG se llenaría, fabrica ya con el 5 % del material
      // (o con lo que entra en ese tiempo, si es más). Así nunca se desborda ni los Smelters trabajan para nada con el iron lleno.
      // coal → steel (con iron); iron → plate; oil → plastic (1000 oil c/u; kerosene si plastic no está desbloqueado)
      [["coal", "steel"], ["wood", "beam"], ["minerals", "slab"], ["iron", "plate"], ["oil", delOil()]].forEach(function (x) {
        var r = R(x[0]), sube = (game.getResourcePerTick(x[0], true) || 0) * tps();
        if (!(r.maxValue > 0) || sube <= 0) return; // si va bajando no se pierde nada (p. ej. oil con Magnetos)
        if (r.value + sube * A.ANTES_TOPE_SEG < r.maxValue && !lleno(x[0], 0.98)) return;
        var rc = rec(x[1]), porVez = rc && rc.porVez[x[0]]; if (!porVez) return;
        var usar = Math.max(r.value * A.FABRICAR_PCT, sube * A.ANTES_TOPE_SEG);
        fabricar(x[1], Math.max(1, Math.floor(usar / porVez)), res);
      });
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
  // culture: primero embassies (la más barata) mientras quepan en el tope; el resto en manuscripts, solo si los furs aguantan
  var fursHist = []; // furs cada 10 s (últimos 5 min)
  function fursAguantan() { // no bajaron en los últimos 5 min (con cazas, consumo de los gatitos y parchment incluidos)
    if (fursHist.length < 31) return true;
    return R("furs").value >= fursHist[0];
  }
  function embajadaMasBarata() {
    var mejor = null;
    (game.diplomacy.races || []).forEach(function (r) {
      if (!r.unlocked || !r.embassyPrices) return;
      var p = precios("embassies", r.name).filter(function (x) { return x.name === "culture"; })[0];
      if (p && (!mejor || p.val < mejor.val)) mejor = { raza: r.name, titulo: r.title || r.name, val: p.val };
    });
    return mejor;
  }
  function gastarCultura(res) {
    var cap = R("culture").maxValue, e = null;
    for (var i = 0; i < 5; i++) {
      e = embajadaMasBarata(); if (!e || e.val > cap * 0.99) { e = null; break; }
      if (e.val > libre("culture", res)) break;
      if (!comprar("embassies", e.raza)) break;
      sumar("embajadas", 1); anotar("Embassy con " + e.titulo + " (" + Math.round(e.val) + " culture)");
      e = null;
    }
    var furOk = fursAguantan();
    if (e) d.culturaEstado = "juntando culture para la embassy con " + e.titulo + " (" + Math.round(e.val) + ")";
    else if (!furOk) d.culturaEstado = "sin manuscripts: los furs bajaron en los últimos 5 min (" + Math.round(fursHist[0]) + " → " + Math.round(R("furs").value) + ")";
    else d.culturaEstado = "embassies fuera del tope; la culture va a manuscripts";
    if (e || !furOk) return; // espera la embassy, o los furs no dan para parchment
    manuscriptsConCultura(res);
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
    if (d.plan && d.ejecutando) return null; // con un plan en marcha decide el plan (paso "Festival" si acorta la cola)
    var c = R("culture"); if (c.maxValue && c.maxValue - (res.culture || 0) < FESTIVAL.culture) return null; // no cabe con lo que reserva el plan
    var ef = efectoFestival(); if (!Object.keys(ef).some(function (r) { return ef[r] >= 0.05; })) return null; // sube menos del 5 %: no vale la pena
    var resF = Object.assign({}, res); resF.furs = (res.furs || 0) + A.RESERVA_FURS;
    var parchOk = libre("parchment", res) >= FESTIVAL.parchment || parchmentPosible(resF) - (res.parchment || 0) >= FESTIVAL.parchment;
    if (!parchOk) return null; // sin parchment (o furs) suficiente, ni lo espera: los manuscripts siguen
    var listo = libre("manpower", res) >= FESTIVAL.manpower && libre("culture", res) >= FESTIVAL.culture;
    return { listo: listo };
  }
  // ¿Un festival ahora termina antes la cola? (pedido el 2026-11-19) Simula la cola entera dos veces: tal cual, y con el
  // festival primero: hay que juntar 1500 catpower, 5000 culture y 2500 parchment (los gatitos van a eso y la meta espera),
  // y después todo produce como con festival durante un año (400 días) y vuelve. Conviene si la cola termina antes.
  function medirConFestival(nF) {
    var cal = game.calendar, d0 = cal.festivalDays;
    try { cal.festivalDays = Math.max(d0, 400); return medir(nF); }
    finally { cal.festivalDays = d0; game.village.updateHappines(); game.village.updateResourceProduction(); }
  }
  function evaluarFestival(M, items) {
    if (!d.on.festival || !items.length || !festivalDisponible()) return null;
    if (!(R("culture").maxValue >= FESTIVAL.culture) || !(R("manpower").maxValue >= FESTIVAL.manpower) || !rec("parchment")) return null; // no cabe
    var Mf; try { Mf = medirConFestival(M.nFijos); } catch (e) { console.error(e); return null; }
    var dur = 400 * (game.calendar.ticksPerDay || 10) / tps(); // un año, en segundos reales
    var item = { p: [{ name: "culture", val: FESTIVAL.culture }, { name: "parchment", val: FESTIVAL.parchment }], mp: FESTIVAL.manpower, M: Mf, dur: dur, festival: true };
    var copia = function (l) { return l.map(function (x) { return Object.assign({}, x); }); };
    var sin = tcomp(simular(M, copia(items))), con = tcomp(simular(M, [Object.assign({}, item)].concat(copia(items))));
    var ahorro = sin - con;
    return { conviene: isFinite(con) && (!isFinite(sin) || ahorro >= Math.max(60, sin * 0.01)), ahorro: ahorro, sin: sin, con: con, item: item, dur: dur };
  }
  function pasoFestival(ev) {
    var pr = [{ name: "culture", val: FESTIVAL.culture }, { name: "parchment", val: FESTIVAL.parchment }];
    return { type: "festival", name: "festival", motivo: "festival", ahorro: ev.ahorro, p: pr, reales: pr.concat([{ name: "manpower", val: FESTIVAL.manpower }]) };
  }
  function festival(resF) {
    if (!parchmentHasta(FESTIVAL.parchment + (resF.parchment || 0), resF)) return false;
    var pr = Object.keys(FESTIVAL).map(function (k) { return { name: k, val: FESTIVAL[k] }; });
    if (!pr.every(function (x) { return R(x.name).value >= x.val; })) return false;
    game.resPool.payPrices(pr);
    game.village.holdFestival(1);
    sumar("festivales", 1);
    var ef = efectoFestival(), top = Object.keys(ef).sort(function (a, b) { return ef[b] - ef[a]; }).slice(0, 3);
    anotar("Festival: " + top.map(function (r) { return titulo(r) + " +" + Math.round(ef[r] * 100) + " %"; }).join(", ") + " por " + game.calendar.festivalDays + " días");
    return true;
  }

  // ---------- comercio con todas las razas: cuánto da en promedio un trato (fórmula de js/diplomacy.js, tradeImpl) ----------
  function tratosRazas() {
    var dip = game.diplomacy, vol = dip.getTradeVolume ? dip.getTradeVolume() : 1, out = [];
    var est = game.calendar.getCurSeason ? game.calendar.getCurSeason().name : null;
    (dip.races || []).forEach(function (race) {
      if (!race.unlocked || !race.buys || !race.buys.length || !race.sells || !R(race.buys[0].name)) return;
      var s = dip.getFinalStanding ? dip.getFinalStanding(race) : (race.standing || 0);
      var exito = s < 0 ? Math.max(0, 1 + s) : 1 + 0.25 * Math.min(1, s); // tratos fallidos / con bonus (×1,25)
      var ratio = 1 + (dip.getTradeRatio ? dip.getTradeRatio() : 0) + (dip.calculateTradeBonusFromPolicies ? (dip.calculateTradeBonusFromPolicies(race.name, game) || 0) : 0);
      var da = {};
      race.sells.forEach(function (x) {
        var ch = dip.getResourceTradeChance ? dip.getResourceTradeChance(x, race) : (x.chance || 0);
        if (!(ch > 0) || !R(x.name)) return;
        da[x.name] = exito * Math.min(1, ch) * x.value * ratio * (1 + (race.energy || 0) * 0.02) * (1 + ((x.seasons && est) ? (x.seasons[est] || 0) : 0)) * vol;
      });
      if (race.name === "zebras") { var z = zebras(); if (z) da.titanium = z.ti; }
      out.push({ race: race, titulo: race.title || race.name, da: da, compra: race.buys[0].name, compraVal: race.buys[0].val * vol,
        catpower: dip.getManpowerCost(), gold: dip.getGoldCost() });
    });
    return out;
  }
  // Cuánto vale 1 unidad de un recurso, en segundos de tu producción "a tope" (todos los libres en el mejor oficio
  // para ese recurso + lo que dan Smelters, Calciners…). Lo fabricado vale lo que valen sus insumos.
  // (Kitten Scientists usa la producción del momento; si justo está en negativo o en 0, todo parece valer muchísimo.)
  var capCache = null;
  function capacidades() {
    if (capCache && segundos - capCache.seg < 300) return capCache.v;
    var M = medirSeguro(), v = {};
    game.resPool.resources.forEach(function (res) {
      var r = res.name, j = mejorJob(M, r), c = Math.max(0, M.base[r] || 0) + (j ? M.m[j][r] * M.N : 0);
      M.conv.forEach(function (x) { c += x.outs[r] || 0; });
      if (c > 1e-9) v[r] = c;
    });
    var jh = Object.keys(M.mpCrudo || {}).sort(function (a, b) { return M.mpCrudo[b] - M.mpCrudo[a]; })[0]; // catpower: lo de los hunters antes de cazar
    if (jh) v.manpower = Math.max(v.manpower || 0, M.mpCrudo[jh] * M.N);
    capCache = { seg: segundos, v: v };
    return v;
  }
  function valorSeg(r, caps, prof) {
    if (caps[r] > 0) return 1 / caps[r];
    var rc = (prof || 0) < 5 && esFab(r) ? rec(r) : null; if (!rc) return null; // no lo produces: no se puede valorar
    var s = 0, ok = true;
    Object.keys(rc.porVez).forEach(function (q) { var vq = valorSeg(q, caps, (prof || 0) + 1); if (vq === null) ok = false; else s += vq * rc.porVez[q] / rc.rinde; });
    return ok ? s : null;
  }
  // ¿conviene el trato? (idea de Kitten Scientists, TradeManager.getProfitability): se compara lo que se paga
  // (gold + catpower + lo que pide la raza) con lo que se recibe (solo lo que cabe), todo en segundos de producción.
  function rentabilidad(o) {
    var caps = capacidades(), pagos = { gold: o.gold, manpower: o.catpower }, costo = 0, gana = 0, nCabe = 0;
    pagos[o.compra] = (pagos[o.compra] || 0) + o.compraVal;
    for (var r in pagos) { var vr = valorSeg(r, caps); if (vr === null) return null; costo += pagos[r] * vr; } // se paga con algo que no produces
    Object.keys(o.da).forEach(function (q) {
      var res = R(q), cabe = res.maxValue ? Math.max(0, res.maxValue - res.value) : Infinity, cant = Math.min(o.da[q], cabe);
      if (o.da[q] > 0) nCabe = Math.max(nCabe, cabe / o.da[q]);
      var vq = valorSeg(q, caps); if (!(cant > 0) || vq === null) return;
      gana += cant * vq;
    });
    return { ratio: costo > 0 ? gana / costo : 0, nCabe: Math.floor(nCabe), costo: costo, gana: gana };
  }
  // lo que le falta al plan en curso (en materias primas, sin contar la reserva de insumos)
  function faltaPlanAhora() {
    if (!d.plan || !d.ejecutando || !d.plan.pasos.length) return {};
    var st = {}; game.resPool.resources.forEach(function (r) { st[r.name] = r.value; });
    var lista = d.plan.pasos.map(function (p) { return p.reales || p.p; });
    var o = faltante(sinCol(st, colchonesBase()), lista);
    lista.forEach(function (pr) { pr.forEach(function (x) { var f = x.val - (st[x.name] || 0); if (f > 0) o[x.name] = Math.max(o[x.name] || 0, f); }); }); // también lo fabricado (beam, slab, steel…)
    return o;
  }

  // ---------- ascender al líder con gold (idea de Kitten Scientists, autoPromoteLeader) ----------
  // Costo del juego (js/village.js, goldToPromote): 25 × (rango + 1) de gold, y además la experiencia del líder.
  function ascenderLider(res) {
    var v = game.village, L = v.leader, civ = game.science.get("civil");
    if (!L || !civ || !civ.researched || !v.sim || !v.sim.promote) return;
    var costo = 25 * (L.rank + 1);
    if (R("gold").value - ((res || {}).gold || 0) < costo) { d.liderEstado = "rango " + L.rank + "; el próximo cuesta " + costo + " gold"; return; }
    if (v.sim.expToPromote && !v.sim.expToPromote(L.rank, L.rank + 1, L.exp)[0]) { d.liderEstado = "rango " + L.rank + "; le falta experiencia para el " + (L.rank + 1); return; }
    var antes = L.rank;
    if (v.sim.promote(L, antes + 1) === 1) {
      sumar("ascensos", 1); anotar("Ascendí al líder a rango " + L.rank + " (" + costo + " gold)");
      d.liderEstado = "rango " + L.rank + " (ascendido " + hora() + ")";
      ultimoReparto = -999; d.reestimar = true; // produce más: volver a medir
    }
  }

  // ---------- gold lleno: el sobrante se cambia por lo que le falta al plan (o por titanium si no falta nada) ----------
  function oroATitanio(res) {
    var g = R("gold"), ti = R("titanium");
    var estado = function (txt) { d.oroEstado = txt; };
    var pct = g.maxValue ? g.value / g.maxValue : 0; // primero el gold: casi siempre corta acá, sin calcular los tratos cada segundo
    if (!g.maxValue || pct < A.ORO_RENTABLE_PCT) return estado("esperando que el gold pase el " + Math.round(A.ORO_RENTABLE_PCT * 100) + " % (" + num(g.value) + " / " + num(g.maxValue) + ")");
    var opciones = tratosRazas();
    if (!opciones.length) return estado("todavía no puedes comerciar");
    // con quién: la raza cuyo trato cubre más de lo que falta, sin pagar con algo que también falta
    var falta = faltaPlanAhora(), resT = Object.assign({}, res), cb = colchonesBase(), mejor = null;
    Object.keys(cb).forEach(function (q) { resT[q] = Math.max(resT[q] || 0, cb[q]); }); // nunca paga con los insumos de los Smelters
    opciones.forEach(function (o) {
      if (falta[o.compra] > 0) return;
      var v = 0, que = [];
      Object.keys(o.da).forEach(function (r) { if (falta[r] > 0 && o.da[r] > 0) { v += Math.min(1, o.da[r] / falta[r]); que.push(r); } });
      if (v > 0 && (!mejor || v > mejor.v)) mejor = { o: o, v: v, que: que };
    });
    if (!mejor) { // si al plan no le falta nada que vendan: el trato más rentable (lo que recibe vale más que lo que paga)
      var mr = null;
      opciones.forEach(function (o) {
        if (falta[o.compra] > 0) return;
        var rt = rentabilidad(o); if (!rt || rt.ratio < 1 || rt.nCabe < 1) return;
        if (!mr || rt.ratio > mr.ratio) mr = { o: o, ratio: rt.ratio, nCabe: rt.nCabe };
      });
      if (mr) mejor = { o: mr.o, rent: mr, que: Object.keys(mr.o.da).filter(function (r) { return mr.o.da[r] > 0 && (!R(r).maxValue || R(r).value < R(r).maxValue); }) };
    }
    if (!mejor) {
      if (pct < A.ORO_TRATOS_PCT) return estado("ningún trato es rentable ahora; con el gold al " + Math.round(A.ORO_TRATOS_PCT * 100) + " % compra titanium (" + num(g.value) + " / " + num(g.maxValue) + ")");
      var oz = opciones.filter(function (o) { return o.race.name === "zebras"; })[0];
      if (!oz) return estado("al plan no le falta nada que vendan las razas, ningún trato es rentable y todavía no puedes comerciar con las Zebras");
      if (ti.maxValue && ti.value >= ti.maxValue * 0.98) return estado("al plan no le falta nada, ningún trato es rentable y el titanium está lleno");
      mejor = { o: oz, que: ["titanium"] };
    }
    var z = mejor.o;
    var n = Math.floor((g.value - Math.max(g.maxValue * A.ORO_DEJAR_PCT, res.gold || 0)) / z.gold);
    if (mejor.v) { // no más tratos de los que hacen falta
      var nec = 0; mejor.que.forEach(function (r) { nec = Math.max(nec, Math.ceil(falta[r] / z.da[r])); });
      n = Math.min(n, nec);
    }
    if (mejor.rent) n = Math.min(n, mejor.rent.nCabe); // no comerciar más de lo que cabe (Kitten Scientists)
    if (n < 1) return estado("el plan necesita ese gold");
    // catpower: cada trato pide z.catpower (los Mints también lo consumen)
    var nCat = Math.floor(libre("manpower", res) / z.catpower); // para comerciar no hace falta la reserva de caza (sí la de los Mints)
    if (nCat < 1) {
      var mint = game.bld.get("mint"), cons = consumoPorSeg("manpower");
      return estado("falta catpower: hay " + num(R("manpower").value) + ", cada trato pide " + z.catpower + (res.manpower ? " y se guardan " + num(res.manpower) + " para los Mints" : "") +
        (mint && mint.on ? " (tus " + mint.on + " Mints consumen " + num(cons) + "/s)" : "") + ". Hacen falta hunters.");
    }
    n = Math.min(n, nCat, game.diplomacy.getMaxTradeAmt(z.race) || n);
    // slabs (lo que piden las Zebras): solo los de los tratos que se pueden hacer. Salen de la "cuenta aparte" de los
    // miners de mantenimiento (modo edificios) o de lo que sobre; nunca de la reserva de Smelters/Calciner.
    var faltaS = n * z.compraVal - libre(z.compra, resT), rc = rec(z.compra);
    if (faltaS > 0 && rc && esFab(z.compra)) { // wood no: saldría del catnip
      var resS = Object.assign({}, res), col0 = colchonesBase(), antes = {};
      Object.keys(rc.porVez).forEach(function (q) {
        antes[q] = R(q).value;
        var usable = Math.max(0, Math.min((d.cuentaTratos || {})[q] || 0, R(q).value - (col0[q] || 0)));
        resS[q] = Math.max(col0[q] || 0, Math.min(res[q] || 0, R(q).value - usable));
      });
      fabricar(z.compra, Math.ceil(faltaS / rc.rinde), resS);
      Object.keys(antes).forEach(function (q) { if (d.cuentaTratos && d.cuentaTratos[q]) d.cuentaTratos[q] = Math.max(0, d.cuentaTratos[q] - (antes[q] - R(q).value)); });
    }
    var nSlab = Math.floor(libre(z.compra, resT) / z.compraVal);
    if (nSlab < 1) return estado("para comerciar con " + z.titulo + " faltan " + titulo(z.compra) + " (" + num(z.compraVal) + " por trato; lo que hay lo necesita el plan o la reserva de los Smelters)");
    n = Math.min(n, nSlab);
    if (n < 1) return estado("el plan necesita ese gold");
    var antes = {}; Object.keys(z.da).forEach(function (r) { antes[r] = R(r).value; });
    game.diplomacy.tradeMultiple(z.race, n);
    var gano = Object.keys(antes).map(function (r) { return { r: r, v: R(r).value - antes[r] }; }).filter(function (x) { return x.v > 0; });
    sumar("tratos", n); if (z.race.name === "zebras") sumar("titanium", R("titanium").value - (antes.titanium || 0));
    var txt = gano.map(function (x) { return "+" + num(x.v) + " " + titulo(x.r); }).join(", ") || "nada (mala suerte)";
    estado("comerció " + n + " veces con " + z.titulo + " por " + mejor.que.map(titulo).join(", ") + " (" + hora() + ")");
    anotar("Gold: " + n + " tratos con " + z.titulo + (mejor.v ? " (al plan le falta " + mejor.que.map(titulo).join(", ") + ")" : mejor.rent ? " (rentable: recibe " + mejor.rent.ratio.toFixed(1) + " veces lo que paga)" : "") + " → " + txt);
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
    if ((res || {}).faith > 0) return; // Praise gasta toda la faith: no si el plan la necesita
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
  // [opción, nombre corto, explicación (tooltip)]
  var FUN = [
    ["cielo", "Observe the sky", "Pulsa el botón del cielo cuando aparece."],
    ["refinar", "Refinar catnip", "Con el catnip al 99 %, refina de a 5 (en invierno aguanta con lo guardado)."],
    ["cazar", "Cazar", "Caza cuando el catpower se llena o el plan necesita furs/ivory. Deja " + A.RESERVA_CAZA + " de catpower."],
    ["manuscript", "Culture", "Con la culture al " + Math.round(A.CULTURA_PCT * 100) + " %: primero embassies (la más barata, mientras quepa en el tope); después manuscripts, solo si los furs no bajaron en los últimos 5 min."],
    ["steel", "Steel", "Cada " + A.STEEL_CADA_SEG + " s fabrica steel con el coal y el iron que el plan no necesita."],
    ["bsp", "No llegar al tope", "Coal, wood, minerals, iron y oil nunca llegan al tope: si en " + A.ANTES_TOPE_SEG + " s se llenarían, fabrica steel, beam, slab, plate o plastic (kerosene si plastic no está desbloqueado) con el " + Math.round(A.FABRICAR_PCT * 100) + " % del material (o lo que entra en ese tiempo, si es más). Así no se pierde lo que se produce ni los Smelters trabajan para nada. Nunca toca lo que reserva el plan."],
    ["fe", "Fe", "Compra la mejora de religión más barata que alcance; si no conviene esperar, Praise the sun."],
    ["unicornios", "Unicorns", "Compra lo que se paga antes: Unicorn Pasture o mejoras del Ziggurat (sacrificando solo lo necesario)."],
    ["festival", "Festivales", "Desde Drama. Con un plan en marcha: simula la cola entera con y sin un festival ahora (contando lo que tardan los gatitos en juntar 1500 catpower, 5000 culture y 2500 parchment, y la producción extra durante el año que dura). Si la cola termina antes, agrega el paso \"Festival\" al principio; si no, vuelve a revisar cada 10 min. Sin plan: si sube la producción al menos 5 %."],
    ["oportunidad", "Oportunidad", "Mejoras del workshop con lo que sobra: recursos casi llenos o precio chico. Nunca toca lo que reserva el plan."],
    ["oroTitanio", "Gold → tratos", "Con el gold sobre el " + Math.round(A.ORO_RENTABLE_PCT * 100) + " %: comercia por lo que le falta al plan o por el trato más rentable. Al " + Math.round(A.ORO_TRATOS_PCT * 100) + " %, titanium con las Zebras. Siempre deja el " + Math.round(A.ORO_DEJAR_PCT * 100) + " %."],
    ["lider", "Ascender al líder", "Sube de rango al líder cuando hay gold libre (25 × rango siguiente) y le alcanza la experiencia."],
    ["escasos", "Mantener (modo edificios)", "En el modo edificios deja gatitos para que Smelters, Calciners, Mints, Magnetos… nunca se queden sin insumos, guarda " + Math.round(A.COLCHON_SEG / 60) + " min de consumo y agrega Oil Wells si baja el oil."],
    ["mantenerSiempre", "Mantener también con tus metas", "Lo mismo que \"Mantener\", pero también mientras trabaja en tus metas y en la cola: ningún edificio se queda parado. La meta tarda algo más. Necesita \"Mantener\" encendido. Se aplica al calcular (vuelve a calcular después de cambiarlo)."],
    ["edificios", "Modo edificios al terminar", "Al terminar la meta (o la cola), sigue comprando el edificio que tarde menos."],
    ["verde", "Cuidar el medioambiente", "Nunca compra edificios que suban la pollution (Mines, Quarries, Smelters, Calciners, Steamworks, Magnetos, Oil Wells, Factories sin automatización…), salvo que sean tu meta. En el modo edificios compra primero los que la bajan al menos " + Math.round(A.LIMPIA_MIN_PCT * 100) + " % (Factories automatizadas, Solar Farms, Hydro Plants, Reactors)."],
    ["polucion", "Detalle de pollution", "Al pasar el mouse sobre la pollution (arriba del juego): cuánta produce y limpia cada edificio, el nivel y sus efectos, y cuánto falta para el nivel siguiente o para llegar a cero. Basado en Kittens Pollution Tooltip de xpg (MIT). Apagarlo se nota al recargar la página."]];
  function nombresConv(M) { return M.conv.map(function (c) { return etiqueta("buildings", c.nombre); }).join(", ") || "los conversores"; }
  function textoMant(mt) { return Object.keys(mt).map(function (j) { return mt[j] + " " + (JT[j] || j); }).join(" y "); }
  var vista = "";
  // resumen: totales desde que se pegó el script (o desde "Reiniciar")
  var NOMBRES_TOT = [["cazas", "cazas"], ["furs", "furs"], ["ivory", "ivory"], ["parchment", "parchment"], ["manuscript", "manuscripts"], ["compedium", "compendiums"],
    ["steel", "steel"], ["beam", "beams"], ["slab", "slabs"], ["plate", "plates"], ["ship", "barcos"], ["tratos", "tratos"], ["embajadas", "embassies"], ["ascensos", "ascensos del líder"], ["titanium", "titanium (comercio)"],
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
    if (calculando) return '<div style="color:#e0b050;margin-top:6px">Calculando… (el juego sigue andando)</div>';
    var P = d.plan, rk = (d.rankingEdificios || []).map(function (x) { return x.label + " " + tiempo(x.t); }).join("\n");
    if (!P) {
      if (d.colaActiva && d.cola.length) return "<div style='color:#7fd19b;margin-top:6px'>Cola: preparando " + d.cola[0].label + "…</div>";
      if (d.cola.length) return "<div style='color:#9aa3b2;margin-top:6px'>Presiona <b>Recalcular</b> para ver el plan, o <b>Empezar</b>.</div>";
      if (d.modoEdificios && d.on.edificios) return "<div style='color:#7fd19b;margin-top:6px;cursor:help' title=\"" + attr(rk ? "Últimos candidatos:\n" + rk : "") + "\">Modo edificios: buscando el que tarde menos… <button data-a='detener' style='" + est + ";background:#6b2f2f'>Detener</button></div>";
      return "<div style='color:#9aa3b2;margin-top:6px'>Elige una meta y presiona <b>Agregar</b>: se suma a la cola y se calcula el plan.</div>" +
        "<div style='margin-top:4px'><button data-a='edificios' style='" + est + "' title='Sin meta: compra uno tras otro el edificio que tarde menos.'>Solo comprar edificios</button></div>";
    }
    var sinAy = Math.abs(tcomp(P.sim) - P.sinAyuda) > 1 ? "Sin los edificios sugeridos: " + (isFinite(P.sinAyuda) ? (P.sinAyuda > A.HORAS_MAX * 3600 ? "unas " : "") + tiempo(P.sinAyuda) : "nunca a ese ritmo") : "";
    var h = "", gris = function (t, tip) { return "<span style='color:#9aa3b2;font-size:11.5px" + (tip ? ";cursor:help" : "") + "'" + (tip ? " title=\"" + attr(tip) + "\"" : "") + ">" + t + "</span>"; };
    // encabezado: meta y tiempo; lo demás (cola, mantenimiento, sin ayudas, corrección por el historial) en el tooltip
    var tipMeta = [P.auto ? "Modo edificios: el que tarda menos" + (rk ? "\nCandidatos:\n" + rk : "") : "",
      P.deCola && d.cola.length > 1 ? "Meta 1 de " + d.cola.length + " de la cola" + (P.nSig ? "; el plan mira también las " + P.nSig + " siguientes" : "") : "",
      mantActivo2(P) ? "Manteniendo andando: " + nombresConv(P.M) : "", sinAy, sinHtml(textoCorregido(P.sim)).trim(),
      d.ejecutando ? "El tiempo baja cada 2 s; se vuelve a calcular cada 5 min y tras cada compra." : ""].filter(Boolean).join("\n");
    h += "<div style='margin:6px 0 2px;font-size:13.5px;cursor:help' title=\"" + attr(tipMeta) + "\">" + (P.auto ? "🏗 " : "") + "<b>" + P.label + "</b> — <b style='color:#7fd19b'>" + textoRestante(P) + "</b></div>";
    // avisos: una línea cada uno, el texto completo al pasar el mouse
    if (d.atasco && d.ejecutando) h += avisoCorto(d.atasco, "#e57373");
    (P.avisos || []).forEach(function (a) { h += avisoCorto(a, "#e0b050"); });
    if (P.imposible) h += avisoCorto("Sin tope para " + Object.keys(P.imposible).map(titulo).join(", ") + ": no encontré edificios que lo suban lo suficiente", "#e57373");
    if (P.sinZebras) h += avisoCorto("Sin Zebras: faltan " + num(P.faltaTi) + " de titanium: no puedes comerciar con las Zebras todavía (necesitas al menos 1 barco)", "#e57373");
    if (!isFinite(P.sim.t) && P.sim.avance) { // no alcanza en el límite: hasta dónde llega
      h += det("avance", "En " + textoLimite() + " llegarías a…", P.sim.avance.slice(0, 5).map(function (x) {
        var tip = "Faltan " + num(x.falta) + "; " + (x.noCabe ? "no cabe en tu almacenamiento" : x.porSeg > 1e-9 ? "+" + num(x.porSeg) + "/s → " + tiempo(x.t) + " más" : "no se produce");
        return "<div title=\"" + attr(tip) + "\" style='cursor:help'>" + titulo(x.r) + " " + Math.round(x.pct * 100) + " %" + (x.noCabe ? " " + gris("no cabe") : "") + "</div>";
      }).join(""), true, "color:#e0b050");
    }
    h += htmlPasos(P);
    // qué te frena: un recurso por línea; el detalle del cálculo, en tooltips
    var mtP = mantenimiento(P.M), por = "";
    P.porRec.slice(0, 6).forEach(function (x) {
      var quien = x.solo ? "no depende de gatitos" : x.conv ? x.conv + " a tope" : (JT[x.job] || x.job);
      por += "<div title=\"" + attr("Falta " + num(x.falta) + " · " + quien) + "\" style='cursor:help'>" + titulo(x.r) + " " + tiempo(x.t) + " " + gris(quien) + "</div>";
    });
    var tipGat = "Los libres juntan un recurso a la vez." + (Object.keys(mtP).length ? "\nSiempre " + textoMant(mtP) + " para mantener " + nombresConv(P.M) + "." : "") +
      "\nCaza: " + Math.round(P.M.caza.furs) + " furs y " + Math.round(P.M.caza.ivory) + " ivory por caza." +
      "\nCatnip: " + num(P.M.cat.prom) + "/s de promedio, " + num(P.M.cat.invierno) + "/s en invierno." +
      (P.tratos && P.zebras ? "\nZebras: éxito " + Math.round(P.zebras.exito * 100) + " %, titanium en el " + Math.round(P.zebras.prob * 100) + " % de los tratos → ~" + num(P.zebras.ti) + " por trato." : "") +
      "\nCalculado en " + P.ms + " ms.";
    var extra = [gris(P.M.N + " libres + " + P.M.nFijos + " farmers", tipGat)];
    if (P.festival) extra.push(gris("festival: " + (P.festival.conviene ? "sí" : "no"), P.festival.conviene ? "Uno ahora " + textoAhorro(P.festival.ahorro) + " en la cola: va primero en los pasos." :
      "No conviene ahora: la cola " + (isFinite(P.festival.ahorro) && P.festival.ahorro < 0 ? "tardaría " + tiempo(-P.festival.ahorro) + " más (juntar 1500 catpower, 5000 culture y 2500 parchment cuesta más de lo que adelanta)" : "terminaría casi igual") + ". Se vuelve a revisar cada 10 min."));
    por += "<div style='margin-top:3px'>" + extra.join(gris(" · ")) + "</div>";
    h += det("porque", "Qué te frena", por, false, "", "Lo que más tarda, con todos los libres en el mejor oficio");
    // los botones del plan de la cola están en la cola; el modo edificios tiene los suyos
    if (P.auto) h += "<div style='margin-top:6px'>" + botonesMarcha() + "</div>";
    return h;
  }
  function mantActivo2(P) { return !!d.on.escasos && (!!P.auto || !!d.on.mantenerSiempre); }
  // Empezar / Pausar / Detener / Recalcular: los mismos para la cola y para el modo edificios
  function botonesMarcha() {
    var corre = d.ejecutando || d.colaActiva;
    return "<span style='display:inline-flex;gap:6px;flex-wrap:wrap'>" +
      (corre ? "<button data-a='pausa' style='" + est + "'>" + (d.pausa ? "Reanudar" : "Pausar") + "</button>" +
          "<button data-a='detener' style='" + est + ";background:#6b2f2f' title='Para ya. La cola queda guardada.'>Detener</button>"
        : (d.cola.length ? "<button data-a='empezar' style='" + est + ";background:#2f6b45' title='Hace las metas de la cola una tras otra, sin preguntar.'>Empezar</button>" : "")) +
      "<button data-a='recalcular' style='" + est + ";background:#2a4a6b' title='Vuelve a calcular con lo que tienes ahora: el mejor plan para toda la cola y sus tiempos. Si está en marcha, sigue.'>Recalcular</button></span>";
  }
  function estadoMarcha() {
    if (d.ejecutando && d.pausa) return "<span style='color:#e0b050'>⏸ en pausa</span>";
    if (d.ejecutando || d.colaActiva) return "<span style='color:#7fd19b'>▶ en marcha</span>";
    return "<span style='color:#9aa3b2'>■ detenida</span>";
  }
  // tiempo de una meta de la cola: lo estimado al calcular menos lo que pasó desde entonces
  function tiempoCola(e) {
    if (!e || !isFinite(e.t)) return e;
    var pasado = d.ejecutando && !d.pausa && d.colaEstDesde ? (Date.now() - d.colaEstDesde) / 1000 : 0;
    return Math.max(1, e.t - pasado);
  }
  function htmlCola() {
    if (!d.cola.length) return "";
    var h = d.cola.map(function (c, i) {
      var e = (d.colaEst || {})[c.type + "|" + c.name + "|" + i];
      var esPlan = i === 0 && d.plan && d.plan.deCola && !d.plan.metaHecha && d.plan.type === c.type && d.plan.name === c.name;
      var activo = esPlan && d.ejecutando;
      var t = esPlan && isFinite(tcomp(d.plan.sim)) ? (d.ejecutando ? restante(d.plan) : tcomp(d.plan.sim)) : e && e.t ? tiempoCola(e) : null;
      var txt = t !== null && isFinite(t) ? (e && e.aprox ? "unas " : "~") + tiempo(Math.max(1, t)) : e && e.tope ? "falta tope" : e && e.nunca ? "nunca" : e ? "al llegar" : "";
      var tip = t !== null ? "Desde ahora hasta tenerla, haciendo la cola en orden" : e && e.nunca ? "No se llega a este ritmo (más de " + textoLimite() + ")" : e && e.tope ? "No cabe en tu almacenamiento: al llegar a esta meta se agregan los edificios que suben el tope y se calcula el tiempo" : "Se calcula al llegar a esta meta";
      return "<div style='display:flex;gap:6px;align-items:center" + (activo ? ";color:#fff" : "") + "'>" +
        "<span style='flex:1'>" + (activo ? "▶ " : "<span style='color:#9aa3b2'>" + (i + 1) + ".</span> ") + c.label +
        (txt ? " <span style='color:#9aa3b2;font-size:11.5px;cursor:help' title='" + tip + "'>" + txt + "</span>" : "") + "</span>" +
        (i > 0 ? "<button data-a='colaSubir' data-i='" + i + "' style='" + est + ";padding:0 5px' title='Subir'>↑</button>" : "") +
        "<button data-a='colaQuitar' data-i='" + i + "' style='" + est + ";padding:0 5px' title='Quitar de la cola'>✕</button></div>";
    }).join("");
    h += "<div style='margin-top:4px;display:flex;gap:6px;flex-wrap:wrap;align-items:center'>" + botonesMarcha() +
      "<button data-a='colaVaciar' style='" + est + "' title='Saca todas las metas de la cola'>Vaciar</button></div>";
    // el total va en el título (el detalle, en el tooltip)
    var total = d.colaTotal && d.colaTotal.t && d.cola.length > 1 ? " · ~" + tiempo(tiempoCola(d.colaTotal)) : "";
    var tipT = total ? (d.colaTotal.completa ? "Toda la cola" : "Hasta donde se puede calcular") + ": ~" + tiempo(tiempoCola(d.colaTotal)) + ". Cada meta se vuelve a calcular al llegar." : "";
    return det("cola", "Cola (" + d.cola.length + ") <span style='font-weight:normal'>· " + estadoMarcha() + total + "</span>", h, true, "", tipT);
  }
  function linea(nombre, txt, tip) {
    return "<div style='font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:help' title=\"" + attr(tip || sinHtml(txt)) + "\"><b>" + nombre + ":</b> " + txt + "</div>";
  }
  function pintar() {
    var h = '<div style="display:flex;align-items:center;gap:8px"><b style="flex:1;font-size:14px">Planificador</b><button data-a="x" style="' + est + '" title="Cerrar el panel (los automáticos se detienen)">✕</button></div>';
    h += '<div style="display:flex;gap:6px;margin:8px 0 2px;flex-wrap:wrap"><select id="kgP_meta" style="' + est + ';max-width:240px">' + opcionesMeta() + "</select>" +
      '<button data-a="colaAgregar" style="' + est + ';background:#2a4a6b" title="Agrega esta meta al final de la cola y calcula el mejor plan para toda la cola">Agregar</button></div>';
    if (d.catnipAlerta) h += "<div style='color:#e57373;font-weight:bold;margin-top:4px'>⚠ " + d.catnipAlerta + "</div>";
    h += htmlCola();
    h += '<div id="kgP_plan">' + vista + "</div>";
    // estado de los automáticos: una línea cada uno (el detalle, al pasar el mouse)
    var ests = [], apag = Object.keys(d.apagadosMano || {});
    if (apag.length) ests.push(linea("Apagados por ti", apag.map(function (n) { return etiqueta("buildings", n); }).join(", "), "No los vuelvo a encender. Si los enciendes tú, vuelvo a mantenerlos."));
    if (d.on.lider && d.liderEstado) ests.push(linea("Líder", d.liderEstado));
    if (d.on.oroTitanio && d.oroEstado) ests.push(linea("Gold", d.oroEstado));
    if (d.on.manuscript && d.culturaEstado) ests.push(linea("Culture", d.culturaEstado));
    if (infoUnicornio) ests.push(linea("Unicorns", infoUnicornio.split(" · ")[0], infoUnicornio.replace(/ · /g, "\n")));
    if (ests.length) h += det("estado", "Estado", ests.join(""), true);
    var chk = "<div style='display:grid;grid-template-columns:1fr 1fr;gap:1px 10px'>" + FUN.map(function (f) {
      return '<label style="cursor:help" title="' + attr(f[2]) + '"><input type="checkbox" data-k="' + f[0] + '"' + (d.on[f[0]] ? " checked" : "") + "> " + f[1] + "</label>";
    }).join("") + "</div>";
    h += det("auto", "Automático", chk, false, "", "Pasa el mouse sobre cada opción para ver qué hace");
    h += det("datos", "Datos", abiertos.datos ? "<div style='font-size:11.5px'>" + infoDatos() + "</div>" : "", false); // se arma solo si está abierto (mide el festival y los precios de las casas)
    h += det("resumen", "Resumen", "<div style='font-size:11.5px'>" + infoResumen() + "</div>", false);
    h += det("bitacora", "Bitácora", "<div style='font-size:11.5px;color:#c8cdd6;max-height:140px;overflow:auto'>" + (d.log.slice(0, 20).join("<br>") || "—") + "</div>", false);
    if (h === ultimoHtml) return; // nada cambió: no se redibuja (el tooltip abierto no parpadea)
    ultimoHtml = h;
    var sel = document.getElementById("kgP_meta"), valor = sel ? sel.value : null;
    caja.innerHTML = h;
    if (valor) { var s2 = document.getElementById("kgP_meta"); if (s2) s2.value = valor; }
  }
  caja.addEventListener("change", function (e) { var k = e.target.getAttribute && e.target.getAttribute("data-k"); if (k) { d.on[k] = e.target.checked; guardar(); } });
  // el panel se redibuja cada 2 s: recordar qué secciones dejó abiertas ("toggle" no sube, por eso se escucha en captura)
  caja.addEventListener("toggle", function (e) {
    var k = e.target.getAttribute && e.target.getAttribute("data-det"); if (!k) return;
    var antes = abiertos[k]; abiertos[k] = e.target.open;
    if (k === "datos" && e.target.open && !antes) setTimeout(pintar, 0); // Datos se arma recién al abrirlo
  }, true);
  var ultimoHtml = "";
  async function calcularYMostrar(type, name, opts) {
    calculando = true; vista = pintarPlan(); pintar();
    try { d.plan = await calcularPlan(type, name, opts); d.plan.calculadoEn = Date.now(); anotar("Plan calculado para " + d.plan.label); }
    finally { calculando = false; }
  }

  // =================== COLA: varias metas, una tras otra ===================
  function yaHecha(c) {
    try {
      if (c.type === "tech") return game.science.get(c.name).researched;
      if (c.type === "upgrades") return game.workshop.get(c.name).researched;
    } catch (e) {}
    return false;
  }
  // precio de cada meta de la cola, contando que el mismo edificio repetido sale cada vez más caro
  function preciosCola(desde) {
    var vistos = {};
    return d.cola.slice(desde).map(function (c) {
      if (c.type !== "buildings") return precios(c.type, c.name);
      var k = vistos[c.name] || 0; vistos[c.name] = k + 1;
      return game.bld.getPrices(c.name, k + (desde > 0 && d.cola[0].type === "buildings" && d.cola[0].name === c.name ? 1 : 0));
    });
  }
  // Todo es la cola: el plan es siempre el de su primera meta, calculado mirando las siguientes
  // (las ayudas buscan terminar la cola entera antes sin atrasar la primera). Conserva el cronómetro si la meta es la misma.
  async function calcularCola() {
    d.cola = d.cola.filter(function (c) { return !yaHecha(c); });
    if (!d.cola.length) { if (d.plan && d.plan.deCola) { d.plan = null; d.ejecutando = false; } d.colaActiva = false; d.colaEst = null; d.colaTotal = null; return; }
    var c0 = d.cola[0], P0 = d.plan, guardado = {};
    var misma = P0 && P0.deCola && P0.type === c0.type && P0.name === c0.name;
    if (misma) ["inicio", "estimado", "pausado", "pausaDesde", "hechos"].forEach(function (k) { if (P0[k] !== undefined) guardado[k] = P0[k]; });
    var precs = preciosCola(0);
    var sig = precs.slice(1).map(function (p, j) { return { p: p, i: j + 1 }; });
    await calcularYMostrar(c0.type, c0.name, { siguientes: sig });
    if (!d.plan) return;
    d.plan.deCola = true;
    if (misma) { Object.assign(d.plan, guardado); marcarSim(d.plan); }
    var key = function (c, i) { return c.type + "|" + c.name + "|" + i; };
    var t0 = tcomp(d.plan.sim), ultimo = isFinite(t0) ? t0 : 0, completa = isFinite(d.plan.sim.t);
    d.colaEst = {}; d.colaEstDesde = Date.now();
    d.colaEst[key(c0, 0)] = isFinite(t0) ? { t: Math.max(1, t0), aprox: !isFinite(d.plan.sim.t) } : { nunca: true };
    d.cola.forEach(function (c, i) {
      if (i === 0) return;
      var x = (d.plan.tCola || {})[i];
      if (typeof x === "number") { d.colaEst[key(c, i)] = { t: x }; ultimo = x; }
      else if (x && isFinite(x.est)) { d.colaEst[key(c, i)] = { t: x.est, aprox: true }; ultimo = x.est; completa = false; }
      else { completa = false; d.colaEst[key(c, i)] = { tope: Object.keys(topeFaltante(precs[i])).length > 0 }; }
    });
    d.colaTotal = { t: ultimo, completa: completa };
  }
  // Recalcular: el mejor plan para la cola con lo que hay ahora; si estaba en marcha, sigue
  async function recalcular() {
    if (d.plan && d.plan.auto) { d.plan = null; d.ejecutando = false; ultimaBusqueda = -999; anotar("Modo edificios: vuelvo a elegir"); return; }
    var seguir = d.ejecutando;
    await calcularCola();
    if (!d.plan) return;
    if (seguir) { d.ejecutando = true; if (!d.plan.inicio) empezarCronometro(); ultimoReparto = -999; }
  }
  async function empezar() {
    if (!d.cola.length) return;
    if (d.plan && d.plan.auto) { d.plan = null; d.ejecutando = false; }
    d.modoEdificios = false; d.colaActiva = true; d.pausa = false;
    var c0 = d.cola[0];
    // con un plan viejo (más de 1 min), lo vuelve a calcular: lo que hay cambió
    if (!(d.plan && d.plan.deCola && d.plan.type === c0.type && d.plan.name === c0.name && Date.now() - (d.plan.calculadoEn || 0) < 60000)) await calcularCola();
    if (!d.plan || !d.colaActiva) return;
    d.ejecutando = true; ultimoReparto = -999; if (!d.plan.inicio) empezarCronometro();
    anotar("Cola en marcha: " + d.cola.map(function (c) { return c.label; }).join(" → "));
  }
  function detener() {
    var habia = d.ejecutando || d.colaActiva || d.modoEdificios;
    d.ejecutando = false; d.colaActiva = false; d.pausa = false; d.modoEdificios = false;
    if (d.plan && d.plan.auto) d.plan = null;
    if (d.plan) d.plan.inicio = null; // al volver a empezar, el cronómetro arranca de cero
    if (habia) anotar("Detenido" + (d.cola.length ? " (la cola queda guardada)" : ""));
  }
  var colaIniciando = false, colaError = -1e9;
  // al cumplir una meta de la cola, sigue con la siguiente
  async function siguienteDeCola() {
    if (colaIniciando) return; colaIniciando = true;
    try {
      while (d.cola.length && yaHecha(d.cola[0])) { anotar("Cola: " + d.cola[0].label + " ya estaba hecha"); d.cola.shift(); }
      if (!d.cola.length) { d.colaActiva = false; anotar("Cola terminada"); return; }
      var c0 = d.cola[0];
      if (!(d.plan && d.plan.deCola && d.plan.type === c0.type && d.plan.name === c0.name)) await calcularCola();
      if (!d.plan || !d.colaActiva) return;
      d.plan.deCola = true; d.ejecutando = true; d.pausa = false; ultimoReparto = -999; if (!d.plan.inicio) empezarCronometro();
      anotar("Cola: voy por " + d.plan.label + " (" + tiempoPlan(d.plan.sim) + ")" + (d.cola[1] ? "; después " + d.cola[1].label : ""));
      guardar();
    } finally { colaIniciando = false; }
  }

  caja.addEventListener("click", async function (e) {
    var a = e.target.getAttribute && e.target.getAttribute("data-a"); if (!a || calculando) return;
    var i = +(e.target.getAttribute("data-i") || 0);
    try {
      if (a === "x") { clearInterval(timer); caja.remove(); return; }
      var cambioCola = false;
      if (a === "colaAgregar") {
        var v2 = document.getElementById("kgP_meta").value.split("|"), lab = etiqueta(v2[0], v2[1]);
        if (v2[0] !== "buildings" && d.cola.some(function (c) { return c.type === v2[0] && c.name === v2[1]; })) anotar(lab + " ya está en la cola");
        else {
          d.cola.push({ type: v2[0], name: v2[1], label: lab }); anotar("Cola: agregué " + lab); cambioCola = true;
          if ((d.plan && d.plan.auto) || (!d.plan && d.modoEdificios)) { // el modo edificios en marcha le cede el paso a la cola
            var corria = d.ejecutando || d.modoEdificios; if (d.plan) d.plan = null; d.ejecutando = false; d.modoEdificios = false;
            if (corria) { await empezar(); cambioCola = false; }
          }
        }
      }
      if (a === "colaQuitar") { d.cola.splice(i, 1); cambioCola = true; }
      if (a === "colaSubir" && i > 0) { var x = d.cola.splice(i, 1)[0]; d.cola.splice(i - 1, 0, x); cambioCola = true; }
      if (a === "colaVaciar") { if (d.plan && d.plan.deCola) d.plan = null; detener(); d.cola = []; d.colaEst = null; d.colaTotal = null; }
      if (cambioCola) await recalcular(); // cualquier cambio en la cola cambia el mejor plan
      if (a === "recalcular") await recalcular();
      if (a === "empezar") await empezar();
      if (a === "detener") detener();
      if (a === "pausa") { d.pausa = !d.pausa; cronometroPausa(); anotar(d.pausa ? "En pausa" : "Reanudado"); }
      if (a === "resumen0") { d.tot = {}; d.totDesde = Date.now(); }
      if (a === "edificios") { d.modoEdificios = true; ultimaBusqueda = -999; anotar("Modo edificios: compra el edificio que tarde menos"); }
      guardar(); vista = pintarPlan(); pintar();
    } catch (er) { console.error(er); anotar("Error: " + er.message); pintar(); }
  });

  // =================== DETALLE DE POLLUTION ===================
  // Basado en "Kittens Pollution Tooltip" 1.1.1 de xpg (https://xpg.jp/kittensgame/). Cambia el tooltip del
  // ícono de pollution por uno con el detalle por edificio. Esta parte se distribuye bajo su licencia:
  //   MIT License — Copyright (c) 2026 xpg
  //   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
  //   documentation files (the "Software"), to deal in the Software without restriction, including without limitation
  //   the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
  //   to permit persons to whom the Software is furnished to do so, subject to the following conditions:
  //   The above copyright notice and this permission notice shall be included in all copies or substantial portions
  //   of the Software.
  //   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
  //   THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  //   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
  //   CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
  //   DEALINGS IN THE SOFTWARE.
  var POL_EFECTOS = ["cathPollutionPerTickProd", "cathPollutionPerTickCon"];
  function edificiosPolucion(efecto) { // edificios (y sus etapas) que producen o limpian pollution
    var out = [];
    [game.bld.meta, game.space.meta, game.time.meta].forEach(function (grupos) {
      (grupos || []).forEach(function (g) {
        (g.meta || []).forEach(function (b) {
          if (b.stages) b.stages.forEach(function (st, k) { if (st.effects && efecto in st.effects) out.push({ data: st, b: b, etapa: k }); });
          else if (b.effects && efecto in b.effects) out.push({ data: b, b: b, etapa: -1 });
        });
      });
    });
    return out;
  }
  function textoPolucion() {
    var bld = game.bld, pol = bld.cathPollution, porTick = bld.cathPollutionPerTick, tpsJ = game.ticksPerSecond;
    var v = function (x, signo) { return game.getDisplayValueExt(x, !!signo); };
    var fila = function (nombre, txt) { return "<br>" + nombre + ":&nbsp;<div style='float:right;'>" + txt + "</div>"; };
    var filaE = function (nombre, x, limpia) { return "<br>|-> <span class='energy" + (limpia ? "Production" : "Consumption") + "'>" + nombre + ":&nbsp;<span style='float:right;'>" + v(x) + "</span></span>"; };
    var porEdificio = function (efecto) {
      return edificiosPolucion(efecto).map(function (x) {
        if (x.etapa !== -1 && x.etapa !== x.b.stage) return "";
        var n = (x.b.on || 0) * x.data.effects[efecto];
        return n ? fila(x.data.label || x.b.label || x.b.name, v(n, true)) : "";
      }).join("");
    };
    var h = "Pollution por tick: " + (porTick ? "<span class='energy" + (porTick < 0 ? "Production" : "Consumption") + "'>" : "") + v(porTick, true) + (porTick ? "</span>" : "");
    if (pol > 0) {
      var nivel = bld.getPollutionLevel(), ef = bld.pollutionEffects;
      h += "<br>Nivel: " + nivel + "<br>|-> Menos producción de catnip: " + v(ef.catnipPollutionRatio * 100) + " %";
      if (nivel >= 1) h += "<br>|-> Menos felicidad: " + v(ef.pollutionHappines);
      if (nivel >= 2) h += "<br>|-> Los gatitos llegan " + v(ef.pollutionArrivalSlowdown) + " veces más lento";
      if (nivel >= 4) h += "<br>|-> Menos efecto de Solar Revolution (wood, catnip): " + v(ef.solarRevolutionPollution * 100) + " %";
      var base = bld.getPollutionLevelBase();
      if (porTick < 0) {
        var baja = -porTick * tpsJ;
        if (nivel > 0) h += "<br>Al nivel anterior: " + game.toDisplaySeconds(((pol - Math.pow(10, nivel - 1) * base) / baja).toFixed());
        h += "<br>A cero: " + game.toDisplaySeconds((pol / baja).toFixed());
      } else if (porTick > 0) h += "<br>Al nivel siguiente: " + game.toDisplaySeconds(((Math.pow(10, nivel) * base - pol) / (porTick * tpsJ)).toFixed());
    }
    h += "<br>---------- Producen" + porEdificio("cathPollutionPerTickProd");
    var limpia = bld.getCleanEnergy(), sucia = bld.getPollutingEnergy();
    var ratio = 1 - (limpia + sucia !== 0 ? limpia / ((limpia + sucia) * 2) : 0);
    h += fila("Por la energía", "×" + v(ratio * 100) + " %") + filaE("Energía limpia", limpia, true) + filaE("Energía que contamina", sucia, false);
    var r = 1 + game.getEffect("cathPollutionRatio");
    if (r > 1) h += fila("Castigo", v((r - 1) * 100, true) + " %");
    else if (r < 1) h += fila("Reducción", "×" + v(r * 100) + " %");
    h += "<br>---------- Limpian" + porEdificio("cathPollutionPerTickCon");
    if (pol > 0) h += fila("Plantas", v(-pol * bld.pollutionEffects.pollutionDissipationRatio, true));
    // equilibrio: dónde se queda con lo que tienes ahora (las plantas limpian más cuanto más pollution hay)
    var entra = polucionBase(), dis = bld.pollutionEffects.pollutionDissipationRatio, ppm = function (x) { return v(x / bld.getPollutionLevelBase() * 100) + " ppm"; };
    h += "<br>----------";
    if (entra <= 0) h += "<br>Con lo que tienes, llega a <b>cero</b>.";
    else if (dis > 0) { var eq = entra / dis; h += "<br>Se estabiliza en ~" + ppm(eq) + " (nivel " + bld.getPollutionLevel(eq) + ")" + (eq < pol ? ": va bajando" : eq > pol ? ": va subiendo" : ""); }
    // qué edificio más la bajaría (medido con la fórmula del juego)
    var limpios = [];
    game.bld.buildingsData.forEach(function (b) { if (b.unlocked) { var dl = deltaPolucion(b.name); if (dl < 0) limpios.push({ n: b.label || b.name, dl: dl }); } });
    limpios.sort(function (a, b) { return a.dl - b.dl; });
    if (limpios.length) h += "<br>Uno más de cada uno la baja:" + limpios.slice(0, 5).map(function (x) {
      return fila(x.n, v(x.dl, true) + (entra > 0 && dis > 0 ? " → ~" + ppm(Math.max(0, entra + x.dl) / dis) : ""));
    }).join("");
    else if (entra > 0) h += "<br>Ningún edificio que puedas comprar la baja todavía.";
    return h;
  }
  // se revisa cada 10 s: el ícono aparece recién con la pollution, y el juego puede volver a dibujarlo
  function adjuntarPolucion() {
    if (!d.on.polucion || typeof UIUtils === "undefined" || !UIUtils.attachTooltip) return;
    var nodo = document.querySelector(".toolbarIcon.pollutionIcon");
    if (!nodo || nodo.dataset.kgPlanPol === "1" || nodo.dataset.kptTooltipAttached === "1") return; // ya está (o tienes el script original)
    var nuevo = nodo.cloneNode(true); // clonar descarta el tooltip viejo del juego
    nodo.parentNode.replaceChild(nuevo, nodo);
    nuevo.dataset.kgPlanPol = "1";
    UIUtils.attachTooltip(game, nuevo, 0, 100, function () { try { return textoPolucion(); } catch (e) { return "Pollution: no pude armar el detalle (" + e.message + ")"; } });
  }

  // =================== BUCLE ===================
  var timer = setInterval(function () {
    segundos++;
    if (calculando) return;
    try { automaticos(); } catch (e) { console.error("[Planificador auto]", e); }
    try { pasoEjecutar(); } catch (e) { console.error("[Planificador plan]", e); anotar("Error: " + e.message); }
    if (segundos % 5 === 4) try { vigilarAtasco(); } catch (e) { console.error("[Planificador atasco]", e); }
    if (d.plan && d.ejecutando && !d.pausa && (d.reestimar || segundos - ultimaReestimacion >= 300)) {
      ultimaReestimacion = segundos; d.reestimar = false;
      try { reestimar(); } catch (e) { console.error("[Planificador reestimar]", e); }
    }
    if (segundos % 60 === 30) RECETAS = {}; // el bono de fabricación sube con las mejoras y aparecen recetas nuevas (plastic, concrete…)
    if (d.colaActiva && d.cola.length && !d.ejecutando && !d.pausa && !colaIniciando && segundos - colaError >= 60) {
      // si el cálculo falla, espera 1 min antes de reintentar (antes recalculaba cada segundo y trababa el juego)
      siguienteDeCola().catch(function (e) { colaError = segundos; console.error(e); anotar("Cola: error " + e.message + " (reintento en 1 min)"); });
    }
    else if (!d.plan && d.modoEdificios && d.on.edificios && !d.colaActiva && !d.pausa && segundos - ultimaBusqueda >= 30) {
      ultimaBusqueda = segundos;
      siguienteEdificio().catch(function (e) { console.error(e); anotar("Edificios: error " + e.message); });
    }
    if (segundos % 10 === 0) guardar();
    if (segundos % 10 === 1) try { adjuntarPolucion(); } catch (e) { console.error("[Planificador pollution]", e); }
    if (segundos % 2 === 0) {
      if (document.activeElement && document.activeElement.id === "kgP_meta") return;
      vista = pintarPlan(); pintar();
    }
  }, 1000);

  window.__kgPlan = { timer: timer, caja: caja, d: d, _test: { simular: simular, calcularPlan: calcularPlan, medirSeguro: medirSeguro, opcionesUnicornio: opcionesUnicornio, reservas: reservas, caza: caza, zebras: zebras, pasosComercio: pasosComercio, infoDatos: infoDatos,
    planBarcos: planBarcos, efectoFestival: efectoFestival, festivalQuiere: festivalQuiere, oportunidad: oportunidad, lleno: lleno, infoResumen: infoResumen,
    mantenimiento: mantenimiento, oroATitanio: oroATitanio, asignar: asignar, politica: politica,
    rankingEdificios: rankingEdificios, siguienteEdificio: siguienteEdificio,
    colchones: colchones, consumoPorSeg: consumoPorSeg, encenderConsumidores: encenderConsumidores,
    tratosRazas: tratosRazas, rentabilidad: rentabilidad, ascenderLider: ascenderLider, faltaPlanAhora: faltaPlanAhora,
    planAyudas: planAyudas, faltante: faltante, prodActual: prodActual, itemsSiguientes: itemsSiguientes, prefabricarCola: prefabricarCola, preciosCola: preciosCola, calcularCola: calcularCola, evaluarFestival: evaluarFestival } };
  vista = pintarPlan(); pintar();
  if (retomar) { // la página se recargó con un plan en marcha: lo vuelve a calcular y sigue
    var rm = retomar.meta, calc;
    if (rm.auto) calc = calcularYMostrar(rm.type, rm.name, { auto: true });
    else { // todo va por la cola (un plan de antes, sin cola, pasa a ser su primera meta)
      if (!rm.metaHecha && (!d.cola.length || d.cola[0].type !== rm.type || d.cola[0].name !== rm.name)) d.cola.unshift({ type: rm.type, name: rm.name, label: etiqueta(rm.type, rm.name) });
      d.colaActiva = true; calc = calcularCola();
    }
    calc.then(function () {
      if (d.plan) {
        d.ejecutando = true; d.pausa = !!retomar.pausa; d.plan.deCola = !rm.auto;
        ["inicio", "estimado", "pausado", "pausaDesde", "hechos"].forEach(function (k) { if (retomar.meta[k] !== undefined) d.plan[k] = retomar.meta[k]; }); // sigue el mismo cronómetro
        if (!d.plan.inicio) empezarCronometro();
        anotar("Retomé el plan: " + d.plan.label); guardar();
      }
      vista = pintarPlan(); pintar();
    }).catch(function (e) { console.error(e); anotar("No pude retomar el plan: " + e.message); });
  }
  console.log("Planificador listo. Reemplaza al script automático y al de reparto.");
})();
