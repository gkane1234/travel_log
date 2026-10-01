#!/bin/bash
# This launcher only opens the author page. It does not commit photos or videos to git.
# Drag this file to the Dock. It opens the Travel Log author page.
URL="${1:-http://localhost:4321/author/}"
open "$URL"
