#!/usr/bin/env python3
"""
Re-fetch all forecast cache entries from Open-Meteo using current system settings.
This fixes historical predictions when tilt/azimuth/kwp change.

Usage:
  python3 scripts/refetch_forecast.py

Reads settings from data/automation.json, updates data/stats/forecast-cache.json.
"""
import json, sys, os, math, urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_FILE = os.path.join(BASE, 'data', 'stats', 'forecast-cache.json')
AUTO_FILE = os.path.join(BASE, 'data', 'automation.json')
SYSTEM_LOSS = 0.85

def load_settings():
    with open(AUTO_FILE) as f:
        state = json.load(f)
    s = state.get('settings', {})
    w = s.get('weather', {})
    sol = s.get('solar', {})
    return {
        'lat': w.get('lat'),
        'lon': w.get('lon'),
        'kwp': sol.get('kwp', 0),
        'tilt': sol.get('tilt', 0),
        'azimuth': sol.get('azimuth', 0),
    }

def to_om_azimuth(our_az):
    om_az = ((our_az - 180) % 360 + 360) % 360
    return om_az - 360 if om_az > 180 else om_az

def fetch_archive(lat, lon, start, end, tilt, az):
    mapped_az = to_om_azimuth(az)
    url = (
        f'https://archive-api.open-meteo.com/v1/archive'
        f'?latitude={lat}&longitude={lon}'
        f'&start_date={start}&end_date={end}'
        f'&hourly=global_tilted_irradiance'
        f'&tilt={tilt}&azimuth={mapped_az}'
        f'&timezone=auto'
    )
    print(f'  GET {url[:100]}...')
    resp = urllib.request.urlopen(url, timeout=30)
    return json.loads(resp.read())

def gti_to_pv_watts(kwp, gti_wm2):
    return round(kwp * gti_wm2 * SYSTEM_LOSS)

def main():
    cfg = load_settings()
    lat = cfg['lat']
    lon = cfg['lon']
    kwp = cfg['kwp']
    tilt = cfg['tilt']
    azimuth = cfg['azimuth']

    if not lat or not lon or not kwp:
        print('ERROR: lat/lon/kwp not set in automation.json')
        sys.exit(1)

    print(f'Settings: lat={lat}, lon={lon}, kwp={kwp}, tilt={tilt}°, azimuth={azimuth}°')
    print(f'Open-Meteo azimuth: {to_om_azimuth(azimuth)} ({azimuth}° our convention)')

    # Read existing cache
    with open(CACHE_FILE) as f:
        cache = json.load(f)

    dates = sorted(cache['days'].keys())
    if not dates:
        print('No dates in cache')
        return

    print(f'Refetching {len(dates)} days: {dates[0]} to {dates[-1]}')

    data = fetch_archive(lat, lon, dates[0], dates[-1], tilt, azimuth)
    hourly = data.get('hourly', {})
    times = hourly.get('time', [])
    gti = hourly.get('global_tilted_irradiance', [])

    if not times or not gti:
        print('ERROR: No data returned from Open-Meteo')
        sys.exit(1)

    # Group by date
    new_days = {}
    for i in range(min(len(times), len(gti))):
        date = times[i][:10]
        h = int(times[i][11:13])
        if date not in new_days:
            new_days[date] = [0] * 24
        if 0 <= h < 24:
            new_days[date][h] = gti_to_pv_watts(kwp, gti[i])

    # Update cache
    updated = 0
    for date in dates:
        if date in new_days:
            cache['days'][date] = new_days[date]
            updated += 1
            s = sum(new_days[date]) / 1000
            p = max(new_days[date])
            print(f'  {date}: {s:.1f} kWh (peak {p}W)')
        else:
            print(f'  {date}: NO DATA')

    # Save settings metadata alongside forecast data
    cache['tilt'] = tilt
    cache['azimuth'] = azimuth
    cache['kwp'] = kwp
    cache['lat'] = float(lat) if lat else 0
    cache['lon'] = float(lon) if lon else 0

    with open(CACHE_FILE, 'w') as f:
        json.dump(cache, f, indent=1)

    print(f'\nUpdated {updated}/{len(dates)} days → saved to forecast-cache.json')
    print('Daily stats accuracy will auto-update (reads from this cache dynamically).')

if __name__ == '__main__':
    main()
