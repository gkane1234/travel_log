#!/bin/bash
# Drag this file to the Dock. It opens the Travel Log author page.
URL="${1:-http://localhost:4321/author/}"
open "$URL"
