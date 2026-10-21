#!/usr/bin/env python3
"""Sign an APK with APK Signature Scheme v2 (RSA PKCS#1 v1.5 + SHA-256).

usage: apksign.py IN.apk OUT.apk KEYSTORE.jks|.p12 PASSWORD [ALIAS]
Any existing v2/v3 signing block is removed first, so a debug-signed or unsigned
APK can be re-signed. v1 (JAR) signatures are not written: minSdk is 24, which
verifies v2. The zip entries are left untouched, so their alignment is kept.
"""
import hashlib, struct, subprocess, sys, tempfile, os
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.serialization import pkcs12

MAGIC = b'APK Sig Block 42'
V2_ID = 0x7109871a
ALG_RSA_PKCS1_SHA256 = 0x0103
CHUNK = 1 << 20

def u32(n): return struct.pack('<I', n)
def u64(n): return struct.pack('<Q', n)
def lp(b): return u32(len(b)) + b

def find_eocd(b):
    i = b.rfind(b'PK\x05\x06')
    if i < 0: raise SystemExit('not a zip file')
    return i

def split(b):
    """-> entries, central directory, eocd (with original CD offset) and the CD offset field position."""
    e = find_eocd(b)
    cd_size, cd_off = struct.unpack('<II', b[e + 12:e + 20])
    start = cd_off
    if b[cd_off - 16:cd_off] == MAGIC:  # strip an existing signing block
        size = struct.unpack('<Q', b[cd_off - 24:cd_off - 16])[0]
        start = cd_off - size - 8
        if struct.unpack('<Q', b[start:start + 8])[0] != size: raise SystemExit('bad signing block')
    entries = b[:start]
    cd = b[cd_off:cd_off + cd_size]
    eocd = bytearray(b[e:])
    eocd[16:20] = u32(len(entries))
    return entries, cd, bytes(eocd)

def chunked_sha256(parts):
    digests = []
    for p in parts:
        for i in range(0, len(p), CHUNK):
            c = p[i:i + CHUNK]
            digests.append(hashlib.sha256(b'\xa5' + u32(len(c)) + c).digest())
    return hashlib.sha256(b'\x5a' + u32(len(digests)) + b''.join(digests)).digest()

def load_key(path, pw, alias):
    data = open(path, 'rb').read()
    try:
        key, cert, _ = pkcs12.load_key_and_certificates(data, pw.encode())
    except Exception:
        # JKS: convert with keytool to PKCS#12 first
        with tempfile.TemporaryDirectory() as d:
            p12 = os.path.join(d, 'k.p12')
            subprocess.run(['keytool', '-importkeystore', '-srckeystore', path, '-srcstorepass', pw, '-srcalias', alias,
                            '-destkeystore', p12, '-deststoretype', 'PKCS12', '-deststorepass', pw, '-destkeypass', pw, '-noprompt'],
                           check=True, capture_output=True)
            key, cert, _ = pkcs12.load_key_and_certificates(open(p12, 'rb').read(), pw.encode())
    return key, cert

def sign(src, dst, ks, pw, alias='yrgdtr'):
    b = open(src, 'rb').read()
    entries, cd, eocd = split(b)
    key, cert = load_key(ks, pw, alias)
    digest = chunked_sha256([entries, cd, eocd])
    cert_der = cert.public_bytes(serialization.Encoding.DER)
    pub_der = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    signed_data = lp(lp(u32(ALG_RSA_PKCS1_SHA256) + lp(digest))) + lp(lp(cert_der)) + lp(b'')
    sig = key.sign(signed_data, padding.PKCS1v15(), hashes.SHA256())
    signer = lp(signed_data) + lp(lp(u32(ALG_RSA_PKCS1_SHA256) + lp(sig))) + lp(pub_der)
    v2 = lp(lp(signer))
    pair = u64(4 + len(v2)) + u32(V2_ID) + v2
    size = len(pair) + 8 + 16  # pairs + trailing size + magic
    block = u64(size) + pair + u64(size) + MAGIC
    out_eocd = bytearray(eocd)
    out_eocd[16:20] = u32(len(entries) + len(block))
    open(dst, 'wb').write(entries + block + cd + bytes(out_eocd))
    print('signed', dst, 'cert sha256', hashlib.sha256(cert_der).hexdigest())

if __name__ == '__main__':
    a = sys.argv[1:]
    if len(a) < 4: raise SystemExit(__doc__)
    sign(a[0], a[1], a[2], a[3], a[4] if len(a) > 4 else 'yrgdtr')
