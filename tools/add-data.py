#!/usr/bin/env python3
"""Make the private APK: add the section data (data.js) to the public, unsigned release APK.

usage: add-data.py IN-unsigned.apk data.js OUT-unsigned.apk
then:  apksign.py OUT-unsigned.apk Himayath-Sagar-full.apk release.jks PASSWORD

data.js is written by the section build (window.__HS_DATA = {records, structs, areas, meta, sync}).
It holds consumer data and the Google Sheet link, so it is never committed and the APK made
with it is shared privately, never published. Existing zip entries are not moved, so their
alignment is kept; any old signature block is dropped (sign again afterwards).
"""
import shutil, struct, sys, zipfile
src, data, dst = sys.argv[1:4]
b = open(src, 'rb').read()
e = b.rfind(b'PK\x05\x06')
cd_size, cd_off = struct.unpack('<II', b[e + 12:e + 20])
if b[cd_off - 16:cd_off] == b'APK Sig Block 42':  # strip a signing block so entries are followed directly by the central directory
    size = struct.unpack('<Q', b[cd_off - 24:cd_off - 16])[0]
    start = cd_off - size - 8
    eocd = bytearray(b[e:]); eocd[16:20] = struct.pack('<I', start)
    b = b[:start] + b[cd_off:cd_off + cd_size] + bytes(eocd)
open(dst, 'wb').write(b)
with zipfile.ZipFile(dst, 'a', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    if 'assets/public/data.js' in z.namelist(): sys.exit('this APK already has data.js')
    z.write(data, 'assets/public/data.js')
print('added', data, '->', dst)
