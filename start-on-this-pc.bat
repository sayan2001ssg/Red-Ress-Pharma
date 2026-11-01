@echo off
REM Starts Red Ress Billing on this computer at http://localhost:8765
REM Needs Python (https://www.python.org/downloads/) - tick "Add Python to PATH" when installing.
cd /d "%~dp0"
start "" http://localhost:8765/
python -m http.server 8765 --bind 127.0.0.1 || py -m http.server 8765 --bind 127.0.0.1
pause
