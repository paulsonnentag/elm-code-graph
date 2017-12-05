#!/bin/bash

if [ "$#" != 2 ]
  then
    echo "expected 2 parameters: make.sh {workingDir} {filePath}"
    exit 1
fi

cd $1
../../../lib/elm-make --yes --report=json --warn $2
cd ../../..
