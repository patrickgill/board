package main

import (
	"context"

	"github.com/jaypipes/ghw"
	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/docker"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
	psnet "github.com/shirou/gopsutil/v4/net"
	"github.com/shirou/gopsutil/v4/sensors"
)

type Info struct {
	Host   *host.InfoStat         `json:"host"`
	CPU    []cpu.InfoStat         `json:"cpu"`
	Memory *mem.VirtualMemoryStat `json:"memory"`

	Partitions []disk.PartitionStat  `json:"partitions"`
	Interfaces []psnet.InterfaceStat `json:"interfaces"`

	Load         *load.AvgStat             `json:"load"`
	Temperatures []sensors.TemperatureStat `json:"temperatures"`
	Docker       []docker.CgroupDockerStat `json:"docker"`

	NetworkIO []psnet.IOCountersStat `json:"net_io"`
	Users     []host.UserStat        `json:"users"`
	DiskUsage []disk.UsageStat       `json:"disk_usage"`

	VirtualizationSystem string `json:"virt_system"`
	VirtualizationRole   string `json:"virt_role"`
}

func GetInfo(ctx context.Context) *Info {
	h, _ := host.InfoWithContext(ctx)
	c, _ := cpu.InfoWithContext(ctx)
	m, _ := mem.VirtualMemoryWithContext(ctx)
	d, _ := disk.PartitionsWithContext(ctx, true)
	n, _ := psnet.InterfacesWithContext(ctx)
	l, _ := load.AvgWithContext(ctx)
	t, _ := sensors.TemperaturesWithContext(ctx)
	dock, _ := docker.GetDockerStat()
	netIO, _ := psnet.IOCountersWithContext(ctx, true)
	users, _ := host.UsersWithContext(ctx)

	var diskUsage []disk.UsageStat
	for _, p := range d {
		if u, err := disk.UsageWithContext(ctx, p.Mountpoint); err == nil {
			diskUsage = append(diskUsage, *u)
		}
	}

	virtSys, virtRole, _ := host.VirtualizationWithContext(ctx)

	return &Info{
		Host:                 h,
		CPU:                  c,
		Memory:               m,
		Partitions:           d,
		Interfaces:           n,
		Load:                 l,
		Temperatures:         t,
		Docker:               dock,
		NetworkIO:            netIO,
		DiskUsage:            diskUsage,
		Users:                users,
		VirtualizationSystem: virtSys,
		VirtualizationRole:   virtRole,
	}
}

type GHWInfo struct {
	CPU       *ghw.CPUInfo       `json:"cpu,omitempty"`
	Memory    *ghw.MemoryInfo    `json:"memory,omitempty"`
	Block     *ghw.BlockInfo     `json:"block,omitempty"`
	Topology  *ghw.TopologyInfo  `json:"topology,omitempty"`
	Network   *ghw.NetworkInfo   `json:"network,omitempty"`
	PCI       *ghw.PCIInfo       `json:"pci,omitempty"`
	GPU       *ghw.GPUInfo       `json:"gpu,omitempty"`
	Chassis   *ghw.ChassisInfo   `json:"chassis,omitempty"`
	BIOS      *ghw.BIOSInfo      `json:"bios,omitempty"`
	Baseboard *ghw.BaseboardInfo `json:"baseboard,omitempty"`
	Product   *ghw.ProductInfo   `json:"product,omitempty"`
}

func GetGHWInfo(refresh bool) (*GHWInfo, bool, error) {
	// Perform discovery outside of any global locks to prevent blocking server requests
	info := &GHWInfo{}

	// Sequential safe fetches with explicit logging to narrow down hangs
	logger.Info("GHW: Fetching CPU...")
	info.CPU, _ = ghw.CPU()
	logger.Info("GHW: Fetching Memory...")
	info.Memory, _ = ghw.Memory()
	logger.Info("GHW: Fetching Block...")
	info.Block, _ = ghw.Block()
	logger.Info("GHW: Fetching Topology...")
	info.Topology, _ = ghw.Topology()
	logger.Info("GHW: Fetching Network...")
	info.Network, _ = ghw.Network()
	logger.Info("GHW: Fetching PCI...")
	info.PCI, _ = ghw.PCI()
	logger.Info("GHW: Fetching GPU...")
	info.GPU, _ = ghw.GPU()
	logger.Info("GHW: Fetching Chassis...")
	info.Chassis, _ = ghw.Chassis()
	logger.Info("GHW: Fetching BIOS...")
	info.BIOS, _ = ghw.BIOS()
	logger.Info("GHW: Fetching Baseboard...")
	info.Baseboard, _ = ghw.Baseboard()
	logger.Info("GHW: Fetching Product...")
	info.Product, _ = ghw.Product()
	logger.Info("GHW: Discovery complete.")

	return info, false, nil
}
