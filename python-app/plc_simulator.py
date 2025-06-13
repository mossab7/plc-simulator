import tkinter as tk
from tkinter import ttk, messagebox
import threading
import time
import random
from pymodbus.server.sync import StartTcpServer
from pymodbus.datastore import ModbusSequentialDataBlock
from pymodbus.datastore import ModbusSlaveContext, ModbusServerContext

class PLCSimulator:
    def __init__(self, root):
        self.root = root
        self.root.title("PLC Simulator for NPSH Analysis")
        self.root.geometry("800x700")  # Increased height for more controls
        self.root.resizable(True, True)
        
        # Server configuration
        self.ip_address = tk.StringVar(value="0.0.0.0")
        self.port = tk.IntVar(value=502)
        self.server_running = False
        self.server_thread = None
        
        # PLC registers with initial values - updated to match 8x15DMX-3 pump
        self.register_values = {
            1: 0,   # Pump control (0=stop, 1=start)
            2: 0,   # Pump status (0=stopped, 1=running)
            10: 250, # Temperature (25.0°C)
            11: 300, # Pressure (3.00 bar)
            12: 0,   # Flow rate (0.0 m³/h)
            13: 20,  # Static head (2.0 m)
            14: 5,   # Friction losses (0.5 m)
            15: 150, # Suction pipe diameter (150 mm) - updated
            16: 10   # Elevation (1.0 m)
        }
        
        # Create the modbus context
        self.store = ModbusSlaveContext(
            hr=ModbusSequentialDataBlock(0, [0] * 100)
        )
        self.context = ModbusServerContext(slaves=self.store, single=True)
        
        # Initialize UI
        self.create_ui()
        
        # Update initial values in the context
        for reg, value in self.register_values.items():
            self.store.setValues(3, reg, [value])  # 3 = Holding Registers
    
        # Automatically start the server on launch
        self.start_server()
    
        # Start update loop
        self.update_ui()
    
    def create_ui(self):
        # Create notebook with tabs
        notebook = ttk.Notebook(self.root)
        notebook.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)
        
        # Main control tab
        main_frame = ttk.Frame(notebook)
        notebook.add(main_frame, text="PLC Controls")
        
        # Server control frame
        server_frame = ttk.LabelFrame(main_frame, text="Modbus Server")
        server_frame.pack(fill=tk.X, padx=10, pady=10)
        
        # IP and port configuration
        ttk.Label(server_frame, text="IP Address:").grid(row=0, column=0, padx=5, pady=5, sticky=tk.W)
        ttk.Entry(server_frame, textvariable=self.ip_address, width=15).grid(row=0, column=1, padx=5, pady=5, sticky=tk.W)
        
        ttk.Label(server_frame, text="Port:").grid(row=0, column=2, padx=5, pady=5, sticky=tk.W)
        ttk.Entry(server_frame, textvariable=self.port, width=6).grid(row=0, column=3, padx=5, pady=5, sticky=tk.W)
        
        self.server_button = ttk.Button(server_frame, text="Start Server", command=self.toggle_server)
        self.server_button.grid(row=0, column=4, padx=20, pady=5)
        
        self.status_label = ttk.Label(server_frame, text="Server: Stopped", foreground="red")
        self.status_label.grid(row=0, column=5, padx=5, pady=5, sticky=tk.W)
        
        # Left panel - Pump and basic controls
        left_panel = ttk.Frame(main_frame)
        left_panel.pack(side=tk.LEFT, fill=tk.BOTH, expand=False, padx=10, pady=10)
        
        # Pump visualization
        pump_frame = ttk.LabelFrame(left_panel, text="Pump Status - 8x15DMX-3")
        pump_frame.pack(fill=tk.BOTH, expand=False, padx=5, pady=5)
        
        self.pump_canvas = tk.Canvas(pump_frame, width=150, height=150)
        self.pump_canvas.pack(padx=20, pady=20)
        self.draw_pump(running=False)
        
        # Pump control buttons
        control_frame = ttk.LabelFrame(left_panel, text="Pump Control")
        control_frame.pack(fill=tk.X, padx=5, pady=5)
        
        pump_button_frame = ttk.Frame(control_frame)
        pump_button_frame.pack(padx=10, pady=10)
        
        self.start_button = ttk.Button(pump_button_frame, text="Start Pump", 
                                     command=lambda: self.manual_pump_control(True))
        self.start_button.pack(side=tk.LEFT, padx=5)
        
        self.stop_button = ttk.Button(pump_button_frame, text="Stop Pump", 
                                    command=lambda: self.manual_pump_control(False))
        self.stop_button.pack(side=tk.LEFT, padx=5)
        
        # Right panel - Operating data inputs
        right_panel = ttk.Frame(main_frame)
        right_panel.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True, padx=10, pady=10)
        
        # Organize inputs in tab sections
        operating_tabs = ttk.Notebook(right_panel)
        operating_tabs.pack(fill=tk.BOTH, expand=True)
        
        # Basic operating data tab
        basic_frame = ttk.Frame(operating_tabs)
        operating_tabs.add(basic_frame, text="Basic Parameters")
        
        # Advanced operating data tab
        advanced_frame = ttk.Frame(operating_tabs)
        operating_tabs.add(advanced_frame, text="Advanced Parameters")
        
        # Basic operating data variables
        self.temp_var = tk.DoubleVar(value=25.0)
        self.pressure_var = tk.DoubleVar(value=3.0)
        self.flow_var = tk.DoubleVar(value=0.0)
        
        # Advanced operating data variables
        self.static_head_var = tk.DoubleVar(value=2.0)
        self.friction_loss_var = tk.DoubleVar(value=0.5)
        self.pipe_diameter_var = tk.DoubleVar(value=150)  # Updated to 150 mm
        self.elevation_var = tk.DoubleVar(value=1.0)
        
        # Basic operating data controls
        ttk.Label(basic_frame, text="Temperature (°C):").grid(row=0, column=0, padx=5, pady=10, sticky=tk.W)
        self.temp_display = ttk.Label(basic_frame, text="25.0")
        self.temp_display.grid(row=0, column=1, padx=5, pady=10, sticky=tk.W)
        temp_slider = ttk.Scale(basic_frame, from_=0, to=100, variable=self.temp_var, 
                             command=lambda v: self.update_register_from_slider('temp'))
        temp_slider.grid(row=0, column=2, padx=5, pady=10, sticky=tk.EW)
        
        # Add Entry widget for direct input
        temp_entry = ttk.Entry(basic_frame, width=8)
        temp_entry.grid(row=0, column=3, padx=5, pady=10)
        temp_entry.insert(0, "25.0")  # Default value
        # Configure validation
        vcmd = (self.root.register(lambda val: self.validate_numeric_input(val, 0, 100)), '%P')
        temp_entry.config(validate='key', validatecommand=vcmd)
        # Bind to update on Enter key or focus out
        temp_entry.bind('<Return>', lambda e: self.update_from_entry(temp_entry, 'temp', 0, 100))
        temp_entry.bind('<FocusOut>', lambda e: self.update_from_entry(temp_entry, 'temp', 0, 100))
        
        ttk.Label(basic_frame, text="Pressure (bar):").grid(row=1, column=0, padx=5, pady=10, sticky=tk.W)
        self.pressure_display = ttk.Label(basic_frame, text="3.0")
        self.pressure_display.grid(row=1, column=1, padx=5, pady=10, sticky=tk.W)
        pressure_slider = ttk.Scale(basic_frame, from_=0, to=10, variable=self.pressure_var,
                                 command=lambda v: self.update_register_from_slider('pressure'))
        pressure_slider.grid(row=1, column=2, padx=5, pady=10, sticky=tk.EW)
        
        # Add Entry widget for direct input
        pressure_entry = ttk.Entry(basic_frame, width=8)
        pressure_entry.grid(row=1, column=3, padx=5, pady=10)
        pressure_entry.insert(0, "3.0")  # Default value
        # Configure validation
        vcmd = (self.root.register(lambda val: self.validate_numeric_input(val, 0, 10)), '%P')
        pressure_entry.config(validate='key', validatecommand=vcmd)
        # Bind to update on Enter key or focus out
        pressure_entry.bind('<Return>', lambda e: self.update_from_entry(pressure_entry, 'pressure', 0, 10))
        pressure_entry.bind('<FocusOut>', lambda e: self.update_from_entry(pressure_entry, 'pressure', 0, 10))
        
        ttk.Label(basic_frame, text="Flow Rate (m³/h):").grid(row=2, column=0, padx=5, pady=10, sticky=tk.W)
        self.flow_display = ttk.Label(basic_frame, text="0.0")
        self.flow_display.grid(row=2, column=1, padx=5, pady=10, sticky=tk.W)
        self.flow_slider = ttk.Scale(basic_frame, from_=0, to=1200, variable=self.flow_var,  # Updated to 1200 m³/h
                                  command=lambda v: self.update_register_from_slider('flow'))
        self.flow_slider.grid(row=2, column=2, padx=5, pady=10, sticky=tk.EW)
        
        # Add Entry widget for direct input
        flow_entry = ttk.Entry(basic_frame, width=8)
        flow_entry.grid(row=2, column=3, padx=5, pady=10)
        flow_entry.insert(0, "0.0")  # Default value
        # Configure validation
        vcmd = (self.root.register(lambda val: self.validate_numeric_input(val, 0, 1200)), '%P')
        flow_entry.config(validate='key', validatecommand=vcmd)
        # Bind to update on Enter key or focus out
        flow_entry.bind('<Return>', lambda e: self.update_from_entry(flow_entry, 'flow', 0, 1200))
        flow_entry.bind('<FocusOut>', lambda e: self.update_from_entry(flow_entry, 'flow', 0, 1200))
        
        # Advanced operating data controls
        ttk.Label(advanced_frame, text="Static Head (m):").grid(row=0, column=0, padx=5, pady=10, sticky=tk.W)
        self.static_head_display = ttk.Label(advanced_frame, text="2.0")
        self.static_head_display.grid(row=0, column=1, padx=5, pady=10, sticky=tk.W)
        static_head_slider = ttk.Scale(advanced_frame, from_=0, to=10, variable=self.static_head_var,
                                    command=lambda v: self.update_register_from_slider('static_head'))
        static_head_slider.grid(row=0, column=2, padx=5, pady=10, sticky=tk.EW)
        
        # Add Entry widget for direct input
        static_head_entry = ttk.Entry(advanced_frame, width=8)
        static_head_entry.grid(row=0, column=3, padx=5, pady=10)
        static_head_entry.insert(0, "2.0")  # Default value
        # Configure validation
        vcmd = (self.root.register(lambda val: self.validate_numeric_input(val, 0, 10)), '%P')
        static_head_entry.config(validate='key', validatecommand=vcmd)
        # Bind to update on Enter key or focus out
        static_head_entry.bind('<Return>', lambda e: self.update_from_entry(static_head_entry, 'static_head', 0, 10))
        static_head_entry.bind('<FocusOut>', lambda e: self.update_from_entry(static_head_entry, 'static_head', 0, 10))
        
        ttk.Label(advanced_frame, text="Friction Losses (m):").grid(row=1, column=0, padx=5, pady=10, sticky=tk.W)
        self.friction_loss_display = ttk.Label(advanced_frame, text="0.5")
        self.friction_loss_display.grid(row=1, column=1, padx=5, pady=10, sticky=tk.W)
        friction_loss_slider = ttk.Scale(advanced_frame, from_=0, to=5, variable=self.friction_loss_var,
                                      command=lambda v: self.update_register_from_slider('friction_loss'))
        friction_loss_slider.grid(row=1, column=2, padx=5, pady=10, sticky=tk.EW)
        
        # Add Entry widget for direct input
        friction_loss_entry = ttk.Entry(advanced_frame, width=8)
        friction_loss_entry.grid(row=1, column=3, padx=5, pady=10)
        friction_loss_entry.insert(0, "0.5")  # Default value
        # Configure validation
        vcmd = (self.root.register(lambda val: self.validate_numeric_input(val, 0, 5)), '%P')
        friction_loss_entry.config(validate='key', validatecommand=vcmd)
        # Bind to update on Enter key or focus out
        friction_loss_entry.bind('<Return>', lambda e: self.update_from_entry(friction_loss_entry, 'friction_loss', 0, 5))
        friction_loss_entry.bind('<FocusOut>', lambda e: self.update_from_entry(friction_loss_entry, 'friction_loss', 0, 5))
        
        ttk.Label(advanced_frame, text="Suction Pipe Diameter (mm):").grid(row=2, column=0, padx=5, pady=10, sticky=tk.W)
        self.pipe_diameter_display = ttk.Label(advanced_frame, text="150")  # Updated to 150
        self.pipe_diameter_display.grid(row=2, column=1, padx=5, pady=10, sticky=tk.W)
        pipe_diameter_slider = ttk.Scale(advanced_frame, from_=50, to=300, variable=self.pipe_diameter_var,
                                      command=lambda v: self.update_register_from_slider('pipe_diameter'))
        pipe_diameter_slider.grid(row=2, column=2, padx=5, pady=10, sticky=tk.EW)
        
        # Add Entry widget for direct input
        pipe_diameter_entry = ttk.Entry(advanced_frame, width=8)
        pipe_diameter_entry.grid(row=2, column=3, padx=5, pady=10)
        pipe_diameter_entry.insert(0, "150")  # Default value
        # Configure validation
        vcmd = (self.root.register(lambda val: self.validate_numeric_input(val, 50, 300)), '%P')
        pipe_diameter_entry.config(validate='key', validatecommand=vcmd)
        # Bind to update on Enter key or focus out
        pipe_diameter_entry.bind('<Return>', lambda e: self.update_from_entry(pipe_diameter_entry, 'pipe_diameter', 50, 300))
        pipe_diameter_entry.bind('<FocusOut>', lambda e: self.update_from_entry(pipe_diameter_entry, 'pipe_diameter', 50, 300))
        
        ttk.Label(advanced_frame, text="Suction Elevation (m):").grid(row=3, column=0, padx=5, pady=10, sticky=tk.W)
        self.elevation_display = ttk.Label(advanced_frame, text="1.0")
        self.elevation_display.grid(row=3, column=1, padx=5, pady=10, sticky=tk.W)
        elevation_slider = ttk.Scale(advanced_frame, from_=0, to=10, variable=self.elevation_var,
                                   command=lambda v: self.update_register_from_slider('elevation'))
        elevation_slider.grid(row=3, column=2, padx=5, pady=10, sticky=tk.EW)
        
        # Add Entry widget for direct input
        elevation_entry = ttk.Entry(advanced_frame, width=8)
        elevation_entry.grid(row=3, column=3, padx=5, pady=10)
        elevation_entry.insert(0, "1.0")  # Default value
        # Configure validation
        vcmd = (self.root.register(lambda val: self.validate_numeric_input(val, 0, 10)), '%P')
        elevation_entry.config(validate='key', validatecommand=vcmd)
        # Bind to update on Enter key or focus out
        elevation_entry.bind('<Return>', lambda e: self.update_from_entry(elevation_entry, 'elevation', 0, 10))
        elevation_entry.bind('<FocusOut>', lambda e: self.update_from_entry(elevation_entry, 'elevation', 0, 10))
        
        # Add status frame to display calculated NPSH
        status_frame = ttk.LabelFrame(right_panel, text="NPSH Calculation Status")
        status_frame.pack(fill=tk.X, padx=5, pady=5)
        
        # Pump metadata frame
        metadata_frame = ttk.LabelFrame(right_panel, text="8x15DMX-3 Pump Metadata")
        metadata_frame.pack(fill=tk.X, padx=5, pady=5)
        
        # Add pump metadata info
        ttk.Label(metadata_frame, text="Rated Flow:").grid(row=0, column=0, padx=5, pady=2, sticky=tk.W)
        ttk.Label(metadata_frame, text="480 m³/h").grid(row=0, column=1, padx=5, pady=2, sticky=tk.W)
        
        ttk.Label(metadata_frame, text="AOR Range:").grid(row=1, column=0, padx=5, pady=2, sticky=tk.W)
        ttk.Label(metadata_frame, text="100-1200 m³/h").grid(row=1, column=1, padx=5, pady=2, sticky=tk.W)
        
        ttk.Label(metadata_frame, text="POR Range:").grid(row=2, column=0, padx=5, pady=2, sticky=tk.W)
        ttk.Label(metadata_frame, text="200-800 m³/h").grid(row=2, column=1, padx=5, pady=2, sticky=tk.W)
        
        ttk.Label(metadata_frame, text="Rated NPSHr:").grid(row=3, column=0, padx=5, pady=2, sticky=tk.W)
        ttk.Label(metadata_frame, text="16.4 m").grid(row=3, column=1, padx=5, pady=2, sticky=tk.W)
        
        # NPSH status displays
        self.npsha_var = tk.StringVar(value="---")
        self.npshr_var = tk.StringVar(value="---")
        self.margin_var = tk.StringVar(value="---")
        
        ttk.Label(status_frame, text="NPSHa:").grid(row=0, column=0, padx=5, pady=5, sticky=tk.W)
        ttk.Label(status_frame, textvariable=self.npsha_var).grid(row=0, column=1, padx=5, pady=5, sticky=tk.W)
        
        ttk.Label(status_frame, text="NPSHr:").grid(row=1, column=0, padx=5, pady=5, sticky=tk.W)
        ttk.Label(status_frame, textvariable=self.npshr_var).grid(row=1, column=1, padx=5, pady=5, sticky=tk.W)
        
        ttk.Label(status_frame, text="Margin:").grid(row=2, column=0, padx=5, pady=5, sticky=tk.W)
        ttk.Label(status_frame, textvariable=self.margin_var).grid(row=2, column=1, padx=5, pady=5, sticky=tk.W)
        
        # Register monitor tab
        monitor_frame = ttk.Frame(notebook)
        notebook.add(monitor_frame, text="Register Monitor")
        
        # Create a treeview to display all registers
        columns = ('register', 'description', 'value', 'raw_value')
        self.tree = ttk.Treeview(monitor_frame, columns=columns, show='headings')
        
        # Define headings
        self.tree.heading('register', text='Register')
        self.tree.heading('description', text='Description')
        self.tree.heading('value', text='Value')
        self.tree.heading('raw_value', text='Raw Value')
        
        # Define columns width
        self.tree.column('register', width=80)
        self.tree.column('description', width=200)
        self.tree.column('value', width=100)
        self.tree.column('raw_value', width=100)
        
        # Add a scrollbar
        scrollbar = ttk.Scrollbar(monitor_frame, orient=tk.VERTICAL, command=self.tree.yview)
        self.tree.configure(yscroll=scrollbar.set)
        
        # Pack the treeview and scrollbar
        self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=10, pady=10)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y, pady=10)
        
        # Add registers to treeview
        self.tree.insert('', 'end', values=('1', 'Pump Control', '0 (Stop)', '0'))
        self.tree.insert('', 'end', values=('2', 'Pump Status', '0 (Stopped)', '0'))
        self.tree.insert('', 'end', values=('10', 'Temperature', '25.0 °C', '250'))
        self.tree.insert('', 'end', values=('11', 'Pressure', '3.00 bar', '300'))
        self.tree.insert('', 'end', values=('12', 'Flow Rate', '0.0 m³/h', '0'))
        self.tree.insert('', 'end', values=('13', 'Static Head', '2.0 m', '20'))
        self.tree.insert('', 'end', values=('14', 'Friction Losses', '0.5 m', '5'))
        self.tree.insert('', 'end', values=('15', 'Pipe Diameter', '150 mm', '150'))
        self.tree.insert('', 'end', values=('16', 'Elevation', '1.0 m', '10'))
    
    def draw_pump(self, running=False):
        self.pump_canvas.delete("all")
        
        # Draw pump body
        self.pump_canvas.create_oval(20, 50, 130, 130, width=2, outline='black')
        
        # Draw inlet and outlet pipes
        self.pump_canvas.create_line(0, 90, 20, 90, width=4)
        self.pump_canvas.create_line(130, 90, 150, 90, width=4)
        
        # Draw impeller
        if running:
            # Animated impeller (rotating)
            self.pump_canvas.create_arc(40, 70, 110, 110, start=30, extent=60, style=tk.PIESLICE, fill='green')
            self.pump_canvas.create_arc(40, 70, 110, 110, start=150, extent=60, style=tk.PIESLICE, fill='green')
            self.pump_canvas.create_arc(40, 70, 110, 110, start=270, extent=60, style=tk.PIESLICE, fill='green')
            
            # Flow indicators
            self.pump_canvas.create_polygon(130, 85, 140, 80, 140, 90, fill='blue')
            
            # Running text
            self.pump_canvas.create_text(75, 30, text="RUNNING", fill="green", font=("Arial", 12, "bold"))
        else:
            # Static impeller
            self.pump_canvas.create_arc(40, 70, 110, 110, start=0, extent=60, style=tk.PIESLICE, fill='red')
            self.pump_canvas.create_arc(40, 70, 110, 110, start=120, extent=60, style=tk.PIESLICE, fill='red')
            self.pump_canvas.create_arc(40, 70, 110, 110, start=240, extent=60, style=tk.PIESLICE, fill='red')
            
            # Stopped text
            self.pump_canvas.create_text(75, 30, text="STOPPED", fill="red", font=("Arial", 12, "bold"))
    
    def toggle_server(self):
        if not self.server_running:
            self.start_server()
        else:
            self.stop_server()
    
    def start_server(self):
        try:
            # Disable server controls
            self.server_button.config(text="Stop Server")
            self.status_label.config(text="Server: Starting...", foreground="orange")
            self.root.update()
            
            # Start Modbus server in a separate thread
            self.server_running = True
            self.server_thread = threading.Thread(target=self.run_server)
            self.server_thread.daemon = True
            self.server_thread.start()
            
            self.status_label.config(text="Server: Running", foreground="green")
        except Exception as e:
            messagebox.showerror("Server Error", f"Failed to start server: {str(e)}")
            self.server_button.config(text="Start Server")
            self.status_label.config(text="Server: Error", foreground="red")
            self.server_running = False
    
    def run_server(self):
        try:
            StartTcpServer(
                context=self.context,
                address=(self.ip_address.get(), self.port.get())
            )
        except Exception as e:
            print(f"Server error: {str(e)}")
            self.server_running = False
    
    def stop_server(self):
        # Note: This doesn't actually stop the server thread cleanly
        # In a real application, you'd want a better shutdown mechanism
        self.server_running = False
        self.server_button.config(text="Start Server")
        self.status_label.config(text="Server: Stopped", foreground="red")
        messagebox.showinfo("Server Stopped", 
                           "The server has been requested to stop. You may need to restart the application to start it again.")
    
    def update_register_from_slider(self, control_type):
        if control_type == 'temp':
            value = self.temp_var.get()
            raw_value = int(value * 10)  # Scale for PLC (25.0°C = 250)
            self.register_values[10] = raw_value
            self.temp_display.config(text=f"{value:.1f}")
            self.store.setValues(3, 10, [raw_value])
            
        elif control_type == 'pressure':
            value = self.pressure_var.get()
            raw_value = int(value * 100)  # Scale for PLC (3.00 bar = 300)
            self.register_values[11] = raw_value
            self.pressure_display.config(text=f"{value:.2f}")
            self.store.setValues(3, 11, [raw_value])
            
        elif control_type == 'flow':
            value = self.flow_var.get()
            raw_value = int(value * 10)  # Scale for PLC (15.0 m³/h = 150)
            self.register_values[12] = raw_value
            self.flow_display.config(text=f"{value:.1f}")
            self.store.setValues(3, 12, [raw_value])
            
        elif control_type == 'static_head':
            value = self.static_head_var.get()
            raw_value = int(value * 10)  # Scale for PLC (2.0 m = 20)
            self.register_values[13] = raw_value
            self.static_head_display.config(text=f"{value:.1f}")
            self.store.setValues(3, 13, [raw_value])
            
        elif control_type == 'friction_loss':
            value = self.friction_loss_var.get()
            raw_value = int(value * 10)  # Scale for PLC (0.5 m = 5)
            self.register_values[14] = raw_value
            self.friction_loss_display.config(text=f"{value:.1f}")
            self.store.setValues(3, 14, [raw_value])
            
        elif control_type == 'pipe_diameter':
            value = self.pipe_diameter_var.get()
            raw_value = int(value)  # No scaling needed
            self.register_values[15] = raw_value
            self.pipe_diameter_display.config(text=f"{value:.0f}")
            self.store.setValues(3, 15, [raw_value])
            
        elif control_type == 'elevation':
            value = self.elevation_var.get()
            raw_value = int(value * 10)  # Scale for PLC (1.0 m = 10)
            self.register_values[16] = raw_value
            self.elevation_display.config(text=f"{value:.1f}")
            self.store.setValues(3, 16, [raw_value])
        
        # Calculate and update NPSH values
        self.calculate_npsh()
    
    def calculate_npsh(self):
        """Calculate NPSH values for display in the UI"""
        try:
            temp = self.temp_var.get()
            pressure = self.pressure_var.get()
            flow = self.flow_var.get()
            
            # Simple vapor pressure calculation (approximate)
            vapor_pressure = 0.0061 * (1.8 * temp + 32) ** 2 / 100  # in bar
            
            # Convert pressure from bar to meters of water
            pressure_m = pressure * 10.2  # approx. conversion
            
            # Get static head and friction losses
            static_head = self.static_head_var.get()
            friction_loss = self.friction_loss_var.get()
            
            # Calculate NPSHa
            npsha = pressure_m - (vapor_pressure * 10.2) + static_head - friction_loss
            
            # Use the 8x15DMX-3 NPSHr curve - matches the JavaScript implementation
            if flow <= 0:
                npshr = 0.5
            elif flow <= 100:
                npshr = 0.5 + (flow / 100) * 2.7  # Interpolate between 0.5 and 3.2
            elif flow <= 200:
                npshr = 3.2 + (flow - 100) / 100 * 2.8  # Between 3.2 and 6.0
            elif flow <= 300:
                npshr = 6.0 + (flow - 200) / 100 * 3.1  # Between 6.0 and 9.1
            elif flow <= 400:
                npshr = 9.1 + (flow - 300) / 100 * 3.3  # Between 9.1 and 12.4
            elif flow <= 480:
                npshr = 12.4 + (flow - 400) / 80 * 4.0  # Between 12.4 and 16.4
            elif flow <= 550:
                npshr = 16.4 + (flow - 480) / 70 * (-0.6)  # Between 16.4 and 15.8
            elif flow <= 650:
                npshr = 15.8 + (flow - 550) / 100 * (-0.8)  # Between 15.8 and 15.0
            elif flow <= 750:
                npshr = 15.0 + (flow - 650) / 100 * (-0.8)  # Between 15.0 and 14.2
            elif flow <= 850:
                npshr = 14.2 + (flow - 750) / 100 * (-0.2)  # Between 14.2 and 14.0
            elif flow <= 950:
                npshr = 14.0 + (flow - 850) / 100 * 0.4  # Between 14.0 and 14.4
            elif flow <= 1050:
                npshr = 14.4 + (flow - 950) / 100 * 0.8  # Between 14.4 and 15.2
            elif flow <= 1100:
                npshr = 15.2 + (flow - 1050) / 50 * 0.8  # Between 15.2 and 16.0
            elif flow <= 1150:
                npshr = 16.0 + (flow - 1100) / 50 * 1.5  # Between 16.0 and 17.5
            elif flow <= 1200:
                npshr = 17.5 + (flow - 1150) / 50 * 1.5  # Between 17.5 and 19.0
            else:
                npshr = 19.0 + (flow - 1200) / 100 * 2.0  # Extrapolate beyond 1200
            
            # Calculate margin
            margin = npsha - npshr
            
            # Update display
            self.npsha_var.set(f"{npsha:.2f} m")
            self.npshr_var.set(f"{npshr:.2f} m")
            
            if margin >= 0:
                self.margin_var.set(f"{margin:.2f} m ✅")
            else:
                self.margin_var.set(f"{margin:.2f} m ⚠️")
                
        except Exception as e:
            print(f"Error calculating NPSH: {str(e)}")
    
    def manual_pump_control(self, start=True):
        if start:
            self.register_values[1] = 1  # Command to start
            self.register_values[2] = 1  # Status as running
            
            # Set a realistic flow rate when pump starts - specific to 8x15DMX-3
            if self.register_values[12] < 100:  # If flow rate is too low
                self.flow_var.set(random.uniform(200, 600))  # Set flow in the POR range
                self.update_register_from_slider('flow')
        else:
            self.register_values[1] = 0  # Command to stop
            self.register_values[2] = 0  # Status as stopped
            
            # Flow drops to zero when pump stops
            self.flow_var.set(0)
            self.update_register_from_slider('flow')
        
        # Update the Modbus registers
        self.store.setValues(3, 1, [self.register_values[1]])
        self.store.setValues(3, 2, [self.register_values[2]])
    
    def update_ui(self):
        # Detect changes to pump control register
        previous_pump_control = self.register_values[1]
        
        # Read current values from the context
        for reg in self.register_values.keys():
            try:
                # Add more error checking when reading from store
                value = self.store.getValues(3, reg, 1)[0]
                
                # Print debug info if the pump control register changes
                if reg == 1 and value != self.register_values[1]:
                    print(f"Pump control register changed from {self.register_values[1]} to {value}")
                    # Remember the new value for use after the loop
                    new_pump_control = value
                    
                self.register_values[reg] = value
                
                # If pump control register (1) is changed, update pump status register (2)
                if reg == 1:
                    # Ensure pump status matches pump control
                    self.register_values[2] = value
                    self.store.setValues(3, 2, [value])
                    print(f"Updated pump status to {value} to match pump control")
            except Exception as e:
                print(f"Error reading register {reg}: {str(e)}")
        
        # Check if pump control changed from external source (like the website)
        if previous_pump_control != self.register_values[1]:
            if self.register_values[1] == 1:  # Pump starting
                # Set a realistic flow rate when pump starts from external command
                if self.register_values[12] < 100:  # If flow rate is too low
                    print("External pump start detected - setting realistic flow rate")
                    self.flow_var.set(random.uniform(200, 600))  # Set flow in the POR range
                    self.update_register_from_slider('flow')
            else:  # Pump stopping
                # Flow drops to zero when pump stops from external command
                print("External pump stop detected - setting flow to zero")
                self.flow_var.set(0)
                self.update_register_from_slider('flow')
                
        # Update the pump visualization based on status
        pump_running = self.register_values[2] == 1
        self.draw_pump(running=pump_running)
        
        # Update buttons based on pump state
        if pump_running:
            self.start_button.state(['disabled'])
            self.stop_button.state(['!disabled'])
        else:
            self.start_button.state(['!disabled'])
            self.stop_button.state(['disabled'])
        
        # Update treeview
        for i, (reg, value) in enumerate(self.register_values.items()):
            if i >= len(self.tree.get_children()):
                continue  # Skip if there are more registers than tree items
                
            item_id = self.tree.get_children()[i]
            
            if reg == 1:  # Pump Control
                display_value = f"{'1 (Start)' if value == 1 else '0 (Stop)'}"
            elif reg == 2:  # Pump Status
                display_value = f"{'1 (Running)' if value == 1 else '0 (Stopped)'}"
            elif reg == 10:  # Temperature
                display_value = f"{value / 10:.1f} °C"
            elif reg == 11:  # Pressure
                display_value = f"{value / 100:.2f} bar"
            elif reg == 12:  # Flow rate
                display_value = f"{value / 10:.1f} m³/h"
            elif reg == 13:  # Static head
                display_value = f"{value / 10:.1f} m"
            elif reg == 14:  # Friction losses
                display_value = f"{value / 10:.1f} m"
            elif reg == 15:  # Pipe diameter
                display_value = f"{value} mm"
            elif reg == 16:  # Elevation
                display_value = f"{value / 10:.1f} m"
            else:
                display_value = str(value)
            
            self.tree.item(item_id, values=(reg, self.tree.item(item_id)['values'][1], display_value, value))
        
        # Update sliders to match register values
        if not self.temp_var.get() * 10 == self.register_values[10]:
            self.temp_var.set(self.register_values[10] / 10)
            self.temp_display.config(text=f"{self.register_values[10] / 10:.1f}")
            
        if not self.pressure_var.get() * 100 == self.register_values[11]:
            self.pressure_var.set(self.register_values[11] / 100)
            self.pressure_display.config(text=f"{self.register_values[11] / 100:.2f}")
            
        if not self.flow_var.get() * 10 == self.register_values[12]:
            self.flow_var.set(self.register_values[12] / 10)
            self.flow_display.config(text=f"{self.register_values[12] / 10:.1f}")
            
        if not self.static_head_var.get() * 10 == self.register_values[13]:
            self.static_head_var.set(self.register_values[13] / 10)
            self.static_head_display.config(text=f"{self.register_values[13] / 10:.1f}")
            
        if not self.friction_loss_var.get() * 10 == self.register_values[14]:
            self.friction_loss_var.set(self.register_values[14] / 10)
            self.friction_loss_display.config(text=f"{self.register_values[14] / 10:.1f}")
            
        if not self.pipe_diameter_var.get() == self.register_values[15]:
            self.pipe_diameter_var.set(self.register_values[15])
            self.pipe_diameter_display.config(text=f"{self.register_values[15]}")
            
        if not self.elevation_var.get() * 10 == self.register_values[16]:
            self.elevation_var.set(self.register_values[16] / 10)
            self.elevation_display.config(text=f"{self.register_values[16] / 10:.1f}")
        
        # Update NPSH calculations
        self.calculate_npsh()
        
        # Schedule the next update
        self.root.after(500, self.update_ui)

    def stop_pump_request(self):
        """Handle pump stop request from the /plc/stop endpoint"""
        try:
            print('Received stop pump request')
            # Write 0 to register 1 (pump control)
            result = self.store.setValues(3, 1, [0])
            print('Stop pump result:', result)
            
            # Verify the write was successful by reading back the register
            try:
                verify_result = self.store.getValues(3, 1, 1)
                new_value = verify_result[0]
                print(f"Verified pump control register value after write: {new_value}")
                
                if new_value == 0:
                    return {"success": True, "message": "Pump stopped successfully"}
                else:
                    return {"success": False, "message": "Pump control register was not updated"}
            except Exception as verify_error:
                print('Error verifying pump control register:', verify_error)
                return {"success": True, "message": "Pump stop requested, but verification failed"}
        except Exception as error:
            print('Error stopping pump:', error)
            return {"success": False, "message": f"Error stopping pump: {str(error)}"}
    
    @staticmethod
    def validate_numeric_input(value, min_val, max_val):
        if value == "":
            return True
        try:
            float_val = float(value)
            return min_val <= float_val <= max_val
        except ValueError:
            return False
        
    # Update from Entry widget
    def update_from_entry(self, entry_widget, control_type, min_val, max_val):
        try:
            value = float(entry_widget.get())
            if min_val <= value <= max_val:
                # Update the variable which will also update the slider
                if control_type == 'temp':
                    self.temp_var.set(value)
                elif control_type == 'pressure':
                    self.pressure_var.set(value)
                elif control_type == 'flow':
                    self.flow_var.set(value)
                elif control_type == 'static_head':
                    self.static_head_var.set(value)
                elif control_type == 'friction_loss':
                    self.friction_loss_var.set(value)
                elif control_type == 'pipe_diameter':
                    self.pipe_diameter_var.set(value)
                elif control_type == 'elevation':
                    self.elevation_var.set(value)
            
            # Update the PLC register
            self.update_register_from_slider(control_type)
        except ValueError:
            # Reset to current value if not a valid number
            if control_type == 'temp':
                entry_widget.delete(0, tk.END)
                entry_widget.insert(0, f"{self.temp_var.get():.1f}")
            elif control_type == 'pressure':
                entry_widget.delete(0, tk.END)
                entry_widget.insert(0, f"{self.pressure_var.get():.2f}")
            elif control_type == 'flow':
                entry_widget.delete(0, tk.END)
                entry_widget.insert(0, f"{self.flow_var.get():.1f}")
            elif control_type == 'static_head':
                entry_widget.delete(0, tk.END)
                entry_widget.insert(0, f"{self.static_head_var.get():.1f}")
            elif control_type == 'friction_loss':
                entry_widget.delete(0, tk.END)
                entry_widget.insert(0, f"{self.friction_loss_var.get():.1f}")
            elif control_type == 'pipe_diameter':
                entry_widget.delete(0, tk.END)
                entry_widget.insert(0, f"{self.pipe_diameter_var.get():.0f}")
            elif control_type == 'elevation':
                entry_widget.delete(0, tk.END)
                entry_widget.insert(0, f"{self.elevation_var.get():.1f}")

# Add this at the very end of the file to create the main entry point:

if __name__ == "__main__":
    root = tk.Tk()
    app = PLCSimulator(root)
    root.mainloop()