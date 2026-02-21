use serde::Serialize;
use sysinfo::{System, Disks, Networks, Components, Users, Groups};
use std::collections::HashMap;
use std::net::UdpSocket;

#[derive(Serialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cmd: Vec<String>,
    pub exe: String,
    pub status: String,
    pub username: String,
    pub environ: Vec<String>,
    pub cwd: String,
    pub root: String,
    pub memory: u64,
    pub virtual_memory: u64,
    pub start_time: u64,
    pub run_time: u64,
    pub cpu_usage: f32,
    pub mem_pct: f32,
    pub disk_usage: DiskUsageInfo,
}

#[derive(Serialize)]
pub struct DiskUsageInfo {
    pub read_bytes: u64,
    pub written_bytes: u64,
    pub total_read_bytes: u64,
    pub total_written_bytes: u64,
}

#[derive(Serialize)]
pub struct Info {
    pub host_name: String,
    pub os_name: String,
    pub os_version: String,
    pub kernel_version: String,
    pub long_os_version: String,
    // pub distribution_id: String,
    pub boot_time: u64,
    pub uptime: u64,
    pub cpu_count: usize,
    pub global_cpu_info: GlobalCpuInfo,
    pub cpu_info: Vec<CpuInfo>,
    pub memory_total: u64,
    pub memory_used: u64,
    pub memory_free: u64,
    pub swap_total: u64,
    pub swap_used: u64,
    pub swap_free: u64,
    pub disks: Vec<DiskInfo>,
    pub networks: Vec<NetworkInfo>,
    pub users: Vec<UserInfo>,
    pub groups: Vec<GroupInfo>,
    pub components: Vec<SensorInfo>,
    pub top_processes: Vec<ProcessInfo>,
    pub user_process_count: HashMap<String, usize>,
    pub load_avg: [f64; 3],
}

#[derive(Serialize)]
pub struct GlobalCpuInfo {
    pub vendor_id: String,
    pub brand: String,
    pub frequency: u64,
}

#[derive(Serialize)]
pub struct UserInfo {
    pub uid: String,
    pub gid: String,
    pub name: String,
    pub groups: Vec<String>,
}

#[derive(Serialize)]
pub struct GroupInfo {
    pub gid: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct SensorInfo {
    pub label: String,
    pub temperature: f32,
    pub max: Option<f32>,
    pub critical: Option<f32>,
}

#[derive(Serialize)]
pub struct CpuInfo {
    pub name: String,
    pub usage: f32,
    pub frequency: u64,
    pub vendor_id: String,
    pub brand: String,
}

#[derive(Serialize)]
pub struct DiskInfo {
    pub name: String,
    pub mount_point: String,
    pub total: u64,
    pub available: u64,
    pub file_system: String,
    pub kind: String,
    pub is_removable: bool,
}

#[derive(Serialize)]
pub struct NetworkInfo {
    pub name: String,
    pub transmitted: u64,
    pub received: u64,
    pub total_transmitted: u64,
    pub total_received: u64,
    pub mac_address: String,
    pub ip_networks: Vec<String>,
}

pub fn get_system_info() -> Info {
    let mut sys = System::new_all();
    sys.refresh_all();

    let mut cpu_info = Vec::new();
    let mut global_cpu = GlobalCpuInfo {
        vendor_id: String::new(),
        brand: String::new(),
        frequency: 0,
    };
    
    for (i, cpu) in sys.cpus().iter().enumerate() {
        if i == 0 {
             global_cpu.vendor_id = cpu.vendor_id().to_string();
             global_cpu.brand = cpu.brand().to_string();
             global_cpu.frequency = cpu.frequency();
        }
        cpu_info.push(CpuInfo {
            name: cpu.name().to_string(),
            usage: cpu.cpu_usage(),
            frequency: cpu.frequency(),
            vendor_id: cpu.vendor_id().to_string(),
            brand: cpu.brand().to_string(),
        });
    }

    let disks_data = Disks::new_with_refreshed_list();
    let mut disks = Vec::new();
    for disk in &disks_data {
        disks.push(DiskInfo {
            name: disk.name().to_string_lossy().to_string(),
            mount_point: disk.mount_point().to_string_lossy().to_string(),
            total: disk.total_space(),
            available: disk.available_space(),
            file_system: disk.file_system().to_string_lossy().to_string(),
            kind: format!("{:?}", disk.kind()),
            is_removable: disk.is_removable(),
        });
    }

    let networks_data = Networks::new_with_refreshed_list();
    let mut networks = Vec::new();
    for (name, data) in &networks_data {
        let ip_networks = data.ip_networks().iter()
            .map(|ip| ip.to_string())
            .collect();

        networks.push(NetworkInfo {
            name: name.clone(),
            transmitted: data.transmitted(),
            received: data.received(),
            total_transmitted: data.total_transmitted(),
            total_received: data.total_received(),
            mac_address: data.mac_address().to_string(),
            ip_networks,
        });
    }

    let components_data = Components::new_with_refreshed_list();
    let mut sensors = Vec::new();
    for sensor in &components_data {
        sensors.push(SensorInfo {
            label: sensor.label().to_string(),
            temperature: sensor.temperature().unwrap_or(0.0),
            max: sensor.max(),
            critical: sensor.critical(),
        });
    }

    let mut top_processes = Vec::new();
    let mut user_process_count = HashMap::new();
    let total_memory = sys.total_memory();
    let users_data = Users::new_with_refreshed_list();
    
    let mut users = Vec::new();
    for user in &users_data {
        users.push(UserInfo {
            uid: user.id().to_string(),
            gid: user.group_id().to_string(),
            name: user.name().to_string(),
            groups: user.groups().iter().map(|g| g.name().to_string()).collect(), 
        });
    }
    
    let groups_data = Groups::new_with_refreshed_list();
    let groups = groups_data.iter().map(|g| GroupInfo {
       gid: g.id().to_string(),
       name: g.name().to_string(),
    }).collect();

    for (pid, process) in sys.processes() {
        let username = process.user_id()
            .and_then(|uid| users_data.get_user_by_id(uid))
            .map(|u| u.name().to_string())
            .unwrap_or_else(|| "unknown".to_string());
        
        *user_process_count.entry(username.clone()).or_insert(0) += 1;

        let mem_pct = (process.memory() as f32 / total_memory as f32) * 100.0;
        let disk_usage = process.disk_usage();
        
        top_processes.push(ProcessInfo {
            pid: pid.as_u32(),
            name: process.name().to_string_lossy().to_string(),
            username,
            cmd: process.cmd().to_vec().iter().map(|s| s.to_string_lossy().to_string()).collect(),
            exe: process.exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
            status: format!("{:?}", process.status()), // Mapping ProcessStatus to string
            environ: process.environ().iter().map(|s| s.to_string_lossy().to_string()).collect(),
            cwd: process.cwd().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
            root: process.root().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
            memory: process.memory(),
            virtual_memory: process.virtual_memory(),
            start_time: process.start_time(),
            run_time: process.run_time(),
            cpu_usage: process.cpu_usage(),
            mem_pct,
            disk_usage: DiskUsageInfo {
                read_bytes: disk_usage.read_bytes,
                written_bytes: disk_usage.written_bytes,
                total_read_bytes: disk_usage.total_read_bytes,
                total_written_bytes: disk_usage.total_written_bytes,
            },
        });
    }

    top_processes.sort_by(|a, b| b.mem_pct.partial_cmp(&a.mem_pct).unwrap_or(std::cmp::Ordering::Equal));
    top_processes.truncate(10);

    #[cfg(not(windows))]
    let load_avg_data = System::load_average();
    #[cfg(not(windows))]
    let load_avg = [load_avg_data.one, load_avg_data.five, load_avg_data.fifteen];
    #[cfg(windows)]
    let load_avg = [0.0, 0.0, 0.0];

    Info {
        host_name: System::host_name().unwrap_or_default(),
        os_name: System::name().unwrap_or_default(),
        os_version: System::os_version().unwrap_or_default(),
        kernel_version: System::kernel_version().unwrap_or_default(),
        long_os_version: System::long_os_version().unwrap_or_default(),
        // distribution_id: System::distribution_id(),
        boot_time: System::boot_time(),
        uptime: System::uptime(),
        // physical_core_count: sys.physical_core_count().unwrap_or(0),
        cpu_count: sys.cpus().len(),
        global_cpu_info: global_cpu,
        cpu_info,
        memory_total: total_memory,
        memory_used: sys.used_memory(),
        memory_free: sys.free_memory(),
        swap_total: sys.total_swap(),
        swap_used: sys.used_swap(),
        swap_free: sys.free_swap(),
        disks,
        networks,
        users,
        groups,
        components: sensors,
        top_processes,
        user_process_count,
        load_avg,
    }
}

pub fn get_preferred_outbound_ip() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    socket.local_addr().ok().map(|addr| addr.ip().to_string())
}

pub fn get_all_local_ips() -> Vec<String> {
    let mut ips = Vec::new();
    if let Some(ip) = get_preferred_outbound_ip() {
        ips.push(ip);
    }
    ips
}
