"""Clima Vivo Perú — descarga diaria de NOAA OISST v2.1 (vía ERDDAP de NOAA CoastWatch).

Lo ejecuta GitHub Actions cada mañana. Genera data/oisst.json con:
  - el mapa de anomalía del Pacífico tropical (25°N–25°S, 150°E–75°W) del último día;
  - la serie diaria (90 días) de anomalía promedio en Niño 1+2 y Niño 3.4.
No necesita librerías externas.
"""
import json, math, os, sys, time, urllib.request, urllib.parse
from datetime import datetime, timezone

ERD = os.environ.get("ERDDAP_BASE", "https://coastwatch.pfeg.noaa.gov/erddap/griddap/ncdcOisst21NrtAgg")
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "oisst.json")
REGIONS = {  # nombre, latitudes, longitudes (0–360), paso de la malla (×0,25°)
    "n12": ("Niño 1+2", (-10, 0), (270, 280), 2),
    "n34": ("Niño 3.4", (-5, 5), (190, 240), 4),
}
MAP = dict(lat=(-25, 25), lon=(150, 285), stride=2)  # 0,5°


def erddap(query, tries=4):
    url = ERD + ".json?" + urllib.parse.quote(query, safe="():,.-")
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=240) as r:
                t = json.load(r)["table"]
            c = t["columnNames"]
            it, ia, io, iv = c.index("time"), c.index("latitude"), c.index("longitude"), c.index("anom")
            return [(row[it], row[ia], row[io], row[iv]) for row in t["rows"]]
        except Exception as e:  # el servidor a veces tarda: reintenta
            print(f"intento {i+1} falló: {e}", file=sys.stderr)
            time.sleep(20 * (i + 1))
    raise SystemExit("No se pudo descargar de NOAA ERDDAP")


def valid(v):
    return v is not None and not (isinstance(v, float) and math.isnan(v)) and v > -9


def main():
    out = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": "NOAA NCEI OISST v2.1 preliminar (ncdcOisst21NrtAgg), vía NOAA CoastWatch ERDDAP",
           "baseline": "1971-2000"}

    # Mapa del último día
    (la0, la1), (lo0, lo1), s = MAP["lat"], MAP["lon"], MAP["stride"]
    rows = erddap(f"anom[(last)][(0.0)][({la0}):{s}:({la1})][({lo0}):{s}:({lo1})]")
    lats = sorted({r[1] for r in rows}); lons = sorted({r[2] for r in rows})
    grid = {(r[1], r[2]): r[3] for r in rows}
    out["map"] = {
        "date": rows[0][0][:10],
        "lats": lats, "lons": lons,
        # filas de sur a norte; null = tierra
        "v": [[round(grid[(a, o)], 2) if valid(grid.get((a, o))) else None for o in lons] for a in lats],
    }

    # Series diarias por región (promedio ponderado por coseno de la latitud)
    for key, (name, (a0, a1), (o0, o1), st) in REGIONS.items():
        rows = erddap(f"anom[last-89:1:last][(0.0)][({a0}):{st}:({a1})][({o0}):{st}:({o1})]")
        acc = {}
        for t, a, o, v in rows:
            if not valid(v):
                continue
            w = math.cos(math.radians(a))
            s_, w_ = acc.get(t, (0.0, 0.0))
            acc[t] = (s_ + v * w, w_ + w)
        out[key] = {"name": name, "lat": [a0, a1], "lon": [o0, o1],
                    "series": [[t[:10], round(s_ / w_, 3)] for t, (s_, w_) in sorted(acc.items()) if w_ > 0]}

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"OK: mapa del {out['map']['date']}, Niño 1+2 = {out['n12']['series'][-1]}, Niño 3.4 = {out['n34']['series'][-1]}")


if __name__ == "__main__":
    main()
