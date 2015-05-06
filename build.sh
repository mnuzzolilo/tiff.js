#!/bin/bash

export EMCC_CFLAGS="-O2"
#ZLIB_PKGVER=1.2.8
LIBTIFF_PKGVER=4.0.3
#LIBZ_STATIC=
MUST_PATCH=0
OS=`uname`

if [ $OS == 'Darwin' ]
    then
        export LLVM=/usr/local/opt/emscripten/libexec/llvm/bin
        #LIBZ_STATIC=--static
        #echo setting staitc flag for libz: $LIBZ_STATIC
fi

# check prerequisite: tsc
command -v tsc >/dev/null 2>&1 || { echo >&2 "Build requires the tsc command (Typescript) but it's not installed.  Aborting."; exit 1; }

# build zlib
# wget http://zlib.net/current/zlib-${ZLIB_PKGVER}.tar.gz
# tar xf zlib-${ZLIB_PKGVER}.tar.gz
# cd zlib-${ZLIB_PKGVER}
# emconfigure ./configure $LIBZ_STATIC
# emmake make
# cd ..

# build libtiff
if [ ! -d tiff-${LIBTIFF_PKGVER} ];
    then
        wget http://download.osgeo.org/libtiff/tiff-${LIBTIFF_PKGVER}.tar.gz
        tar xzvf tiff-${LIBTIFF_PKGVER}.tar.gz
        MUST_PATCH=1
fi

cd tiff-${LIBTIFF_PKGVER}

if [ MUST_PATCH == 1 ]; then
    # see: https://github.com/kripken/emscripten/issues/662
    patch -p0 < ../tif_open.c.patch
    patch -p0 < ../tiff.h.patch
    emconfigure ./configure --enable-shared
fi

emmake make
cd ..

emcc -o tiff.raw.js \
    $EMCC_CFLAGS \
    -I tiff-${LIBTIFF_PKGVER}/libtiff \
    --pre-js pre.js \
    --post-js post.js \
    -s ALLOW_MEMORY_GROWTH=0 \
    -s TOTAL_MEMORY=134217728 \
    --memory-init-file 0 \
    -s EXPORTED_FUNCTIONS="["\
"'_TIFFReadEncodedStrip',"\
"'_TIFFNumberOfStrips',"\
"'_TIFFStripSize',"\
"'_TIFFOpen',"\
"'_TIFFClose',"\
"'_TIFFGetField',"\
"'_TIFFReadRGBAImage',"\
"'_TIFFReadRGBAImageOriented',"\
"'_TIFFReadRGBAStrip',"\
"'_TIFFSetDirectory',"\
"'_TIFFCurrentDirectory',"\
"'_TIFFReadDirectory',"\
"'__TIFFmalloc',"\
"'__TIFFfree',"\
"'_GetField',"\
"'FS']" \
    export.c \
    tiff-${LIBTIFF_PKGVER}/libtiff/.libs/libtiff.a 
    #zlib-${ZLIB_PKGVER}/libz.a

echo 'var TiffTag = {' > tiff_tag.ts
grep '^#define[[:space:]]\+TIFFTAG_[A-Za-z_]\+[[:space:]]\+' \
    tiff-4.0.3/libtiff/tiff.h \
    | sed -e "s@^\#define[[:space:]]*TIFFTAG_\([A-Za-z_]*\)[[:space:]]*\([A-Za-z0-9]*\).*@  \1 : \2,@g" \
    >> tiff_tag.ts
echo '};' >> tiff_tag.ts

tsc emscripten.d.ts tiff_tag.ts tiff_api.ts -d
cat LICENSE tiff.raw.js > tiff.js
echo '' >> tiff.js
cat tiff_tag.js tiff_api.js >> tiff.js
mv tiff_api.d.ts tiff.d.ts
rm -f tiff_tag.d.ts tiff_tag.js tiff_api.js

closure-compiler \
    --warning_level=QUIET \
    --js=tiff.js \
    --js_output_file=tiff.min.js \
    --language_in ECMASCRIPT5 \
    --output_wrapper="(function() {%output%})();"

#cp tiff.min.js tiff.js tiff.raw.js.mem html

