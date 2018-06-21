#!/bin/bash

if [ "$#" != 1 ]
  then
    echo "expected 1 parameters: install.sh {workingDir}"
    exit 1
fi

cd $1
elm-package install --yes
cd ../../..
