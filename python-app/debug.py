#!/usr/bin/env python3

import os
import sys
import traceback

# Print environment for debugging
print("Python version:", sys.version)
print("DISPLAY:", os.environ.get('DISPLAY'))
print("Current directory:", os.getcwd())
print("Directory contents:", os.listdir())

try:
    # Try to import required modules
    import tkinter as tk
    print("Tkinter imported successfully")
    
    # Try to initialize a basic Tk window
    try:
        root = tk.Tk()
        print("Tk initialized successfully")
        root.destroy()
    except Exception as e:
        print("Tk initialization error:", str(e))
        traceback.print_exc()
        
    # Try to import pymodbus
    from pymodbus.server.sync import StartTcpServer
    print("Pymodbus imported successfully")
    
    # Now try to run the actual plc_simulator
    try:
        print("Attempting to import plc_simulator...")
        from plc_simulator import PLCSimulator
        print("Import successful!")
    except Exception as e:
        print("Error importing plc_simulator:", str(e))
        traceback.print_exc()
        
except Exception as e:
    print("General import error:", str(e))
    traceback.print_exc()

print("Debug script completed")