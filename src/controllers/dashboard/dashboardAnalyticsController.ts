// src/controllers/dashboard/dashboardAnalyticsController.ts
import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiResponse } from "../../utils/apiHandlerHelpers";
import { ApiError } from "../../utils/apiHandlerHelpers";
import { Project } from "../../models/projectModel";
import { User } from "../../models/userModel";
import { Quotation } from "../../models/quotationModel";
import { Attendance } from "../../models/attendanceModel";
import { Payroll } from "../../models/payrollModel";
import { Expense } from "../../models/expenseModel";
import { Estimation } from "../../models/estimationModel";
import { Client } from "../../models/clientModel";
import { VisaExpense } from "../../models/visaExpenseModel";
import { Budget } from "../../models/budgetModel";
import dayjs from "dayjs";
import mongoose from "mongoose";

// Get overview statistics
export const getOverviewStats = asyncHandler(async (req: Request, res: Response) => {
    try {
        // Get total projects
        const totalProjects = await Project.countDocuments();

        // Get active staff (users who are active)
        const activeStaff = await User.countDocuments({
            isActive: true,
            role: { $nin: ['super_admin', 'admin', 'finance'] }
        });

        // Get pending invoices (quotations that are not approved)
        const pendingInvoices = await Quotation.countDocuments({ isApproved: false });

        // Get this month's revenue (sum of netAmount for this month)
        const startOfMonth = dayjs().startOf('month').toDate();
        const endOfMonth = dayjs().endOf('month').toDate();

        const monthlyRevenueResult = await Quotation.aggregate([
            {
                $match: {
                    createdAt: { $gte: startOfMonth, $lte: endOfMonth },
                    isApproved: true
                }
            },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: "$netAmount" }
                }
            }
        ]);

        const monthlyRevenue = monthlyRevenueResult[0]?.totalRevenue || 0;

        // Get this month's payroll
        const currentMonth = dayjs().format('YYYY-MM');
        const payrollStats = await Payroll.aggregate([
            {
                $match: {
                    period: currentMonth
                }
            },
            {
                $group: {
                    _id: null,
                    totalPayroll: { $sum: "$net" },
                    averageSalary: { $avg: "$net" },
                    totalOvertime: { $sum: "$overtime" }
                }
            }
        ]);

        // Get leave days for current month
        const leaveDays = await Attendance.countDocuments({
            date: { $gte: startOfMonth, $lte: endOfMonth },
            isPaidLeave: true
        });

        // Get invoice stats for current month
        const invoiceStats = await Quotation.aggregate([
            {
                $match: {
                    createdAt: { $gte: startOfMonth, $lte: endOfMonth }
                }
            },
            {
                $group: {
                    _id: null,
                    totalInvoices: { $count: {} },
                    totalAmount: { $sum: "$netAmount" },
                    pendingAmount: {
                        $sum: {
                            $cond: [{ $eq: ["$isApproved", false] }, "$netAmount", 0]
                        }
                    },
                    paidAmount: {
                        $sum: {
                            $cond: [{ $eq: ["$isApproved", true] }, "$netAmount", 0]
                        }
                    }
                }
            }
        ]);

        // Get estimation stats
        const estimationStats = await Estimation.aggregate([
            {
                $match: {
                    createdAt: { $gte: startOfMonth, $lte: endOfMonth }
                }
            },
            {
                $group: {
                    _id: null,
                    pending: {
                        $sum: {
                            $cond: [{ $and: [{ $eq: ["$isChecked", false] }, { $eq: ["$isApproved", false] }] }, 1, 0]
                        }
                    },
                    sent: {
                        $sum: {
                            $cond: [{ $and: [{ $eq: ["$isChecked", true] }, { $eq: ["$isApproved", false] }] }, 1, 0]
                        }
                    },
                    converted: {
                        $sum: {
                            $cond: [{ $eq: ["$isApproved", true] }, 1, 0]
                        }
                    }
                }
            }
        ]);

        const stats = {
            totalProjects,
            activeStaff,
            pendingInvoices,
            monthlyRevenue,
            totalPayroll: payrollStats[0]?.totalPayroll || 0,
            averageSalary: payrollStats[0]?.averageSalary || 0,
            overtimeHours: payrollStats[0]?.totalOvertime || 0,
            leaveDays,
            totalInvoices: invoiceStats[0]?.totalInvoices || 0,
            pendingInvoiceAmount: invoiceStats[0]?.pendingAmount || 0,
            paidInvoiceAmount: invoiceStats[0]?.paidAmount || 0,
            estimationStats: estimationStats[0] || { pending: 0, sent: 0, converted: 0 }
        };

        return res.status(200).json(
            new ApiResponse(200, stats, "Overview stats fetched successfully")
        );
    } catch (error) {
        console.error("Error in getOverviewStats:", error);
        throw new ApiError(500, "Failed to fetch overview statistics");
    }
});

// Get attendance data for a date range
export const getAttendanceData = asyncHandler(async (req: Request, res: Response) => {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
        throw new ApiError(400, "Start date and end date are required");
    }

    const start = dayjs(startDate as string).startOf('day').toDate();
    const end = dayjs(endDate as string).endOf('day').toDate();

    try {
        // Get attendance grouped by date
        const attendanceData = await Attendance.aggregate([
            {
                $match: {
                    date: { $gte: start, $lte: end },
                    type: "normal"
                }
            },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
                    present: { $sum: { $cond: [{ $eq: ["$present", true] }, 1, 0] } },
                    absent: { $sum: { $cond: [{ $eq: ["$present", false] }, 1, 0] } },
                    overtimeHours: { $sum: "$overtimeHours" }
                }
            },
            {
                $sort: { _id: 1 }
            }
        ]);

        // Fill in missing dates
        const dates = [];
        let currentDate = dayjs(start);
        const endDateObj = dayjs(end);

        while (currentDate <= endDateObj) {
            dates.push(currentDate.format('YYYY-MM-DD'));
            currentDate = currentDate.add(1, 'day');
        }

        const result = dates.map(date => {
            const data = attendanceData.find(a => a._id === date);
            return {
                date,
                present: data?.present || 0,
                absent: data?.absent || 0,
                overtimeHours: data?.overtimeHours || 0
            };
        });

        return res.status(200).json(
            new ApiResponse(200, result, "Attendance data fetched successfully")
        );
    } catch (error) {
        console.error("Error in getAttendanceData:", error);
        throw new ApiError(500, "Failed to fetch attendance data");
    }
});

// Get financial summary
export const getFinancialSummary = asyncHandler(async (req: Request, res: Response) => {
    const { timeRange } = req.query;

    let startDate, endDate, groupFormat;

    if (timeRange === 'weekly') {
        // Last 7 days grouped by day
        startDate = dayjs().subtract(7, 'day').toDate();
        endDate = new Date();
        groupFormat = "%Y-%m-%d";
    } else {
        // Last 12 months grouped by month
        startDate = dayjs().subtract(12, 'month').startOf('month').toDate();
        endDate = new Date();
        groupFormat = "%Y-%m";
    }

    try {
        // Get quotations data
        const quotationsData = await Quotation.aggregate([
            {
                $match: {
                    createdAt: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: { $dateToString: { format: groupFormat, date: "$createdAt" } },
                    quotations: { $sum: "$netAmount" }
                }
            },
            {
                $sort: { _id: 1 }
            }
        ]);

        // Get expenses data
        const expensesData = await Expense.aggregate([
            {
                $match: {
                    createdAt: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: { $dateToString: { format: groupFormat, date: "$createdAt" } },
                    expenses: {
                        $sum: {
                            $add: [
                                "$totalMaterialCost",
                                "$totalMiscellaneousCost",
                                "$laborDetails.totalLaborCost"
                            ]
                        }
                    }
                }
            },
            {
                $sort: { _id: 1 }
            }
        ]);

        // Merge data
        const result = [];
        const allDates = new Set([
            ...quotationsData.map(q => q._id),
            ...expensesData.map(e => e._id)
        ]);

        const sortedDates = Array.from(allDates).sort();

        sortedDates.forEach(date => {
            const quotation = quotationsData.find(q => q._id === date);
            const expense = expensesData.find(e => e._id === date);

            result.push({
                date,
                quotations: quotation?.quotations || 0,
                expenses: expense?.expenses || 0,
                profit: (quotation?.quotations || 0) - (expense?.expenses || 0)
            });
        });

        return res.status(200).json(
            new ApiResponse(200, result, "Financial summary fetched successfully")
        );
    } catch (error) {
        console.error("Error in getFinancialSummary:", error);
        throw new ApiError(500, "Failed to fetch financial summary");
    }
});

// Get project status distribution
export const getProjectStatus = asyncHandler(async (req: Request, res: Response) => {
    try {
        const projectStatus = await Project.aggregate([
            {
                $group: {
                    _id: "$status",
                    count: { $count: {} }
                }
            },
            {
                $sort: { count: -1 }
            }
        ]);

        const result = projectStatus.map(ps => ({
            status: ps._id,
            count: ps.count
        }));

        return res.status(200).json(
            new ApiResponse(200, result, "Project status fetched successfully")
        );
    } catch (error) {
        console.error("Error in getProjectStatus:", error);
        throw new ApiError(500, "Failed to fetch project status");
    }
});

// Get HR alerts (visa and document expiries)
export const getHRAlerts = asyncHandler(async (req: Request, res: Response) => {
    try {
        const today = new Date();
        const thirtyDaysFromNow = dayjs().add(30, 'day').toDate();

        // Get users with expiring documents
        const usersWithExpiringDocs = await User.find({
            $or: [
                {
                    passportExpiry: {
                        $lte: thirtyDaysFromNow,
                        $gte: today
                    }
                },
                {
                    emiratesIdExpiry: {
                        $lte: thirtyDaysFromNow,
                        $gte: today
                    }
                }
            ]
        }).select('firstName lastName passportExpiry emiratesIdExpiry');

        // Get visa expenses with expiring documents
        const visaExpenses = await VisaExpense.find({
            $or: [
                { passportExpireDate: { $lte: thirtyDaysFromNow, $gte: today } },
                { emirateIdExpireDate: { $lte: thirtyDaysFromNow, $gte: today } },
                { labourExpireDate: { $lte: thirtyDaysFromNow, $gte: today } }
            ]
        }).populate('employee', 'firstName lastName');

        const alerts = [];

        // Add user document expiries
        usersWithExpiringDocs.forEach(user => {
            if (user.passportExpiry) {
                const daysLeft = dayjs(user.passportExpiry).diff(today, 'day');
                alerts.push({
                    id: user._id.toString(),
                    type: 'Passport Expiry',
                    name: `${user.firstName} ${user.lastName}`,
                    date: dayjs(user.passportExpiry).format('YYYY-MM-DD'),
                    daysLeft,
                    severity: daysLeft <= 7 ? 'critical' : daysLeft <= 15 ? 'warning' : 'info'
                });
            }

            if (user.emiratesIdExpiry) {
                const daysLeft = dayjs(user.emiratesIdExpiry).diff(today, 'day');
                alerts.push({
                    id: user._id.toString(),
                    type: 'Emirates ID Expiry',
                    name: `${user.firstName} ${user.lastName}`,
                    date: dayjs(user.emiratesIdExpiry).format('YYYY-MM-DD'),
                    daysLeft,
                    severity: daysLeft <= 7 ? 'critical' : daysLeft <= 15 ? 'warning' : 'info'
                });
            }
        });

        // Add visa expense expiries
        visaExpenses.forEach(visa => {
            if (visa.passportExpireDate) {
                const daysLeft = dayjs(visa.passportExpireDate).diff(today, 'day');
                alerts.push({
                    id: visa._id.toString(),
                    type: 'Passport Expiry',
                    name: `${visa.employee.firstName} ${visa.employee.lastName}`,
                    date: dayjs(visa.passportExpireDate).format('YYYY-MM-DD'),
                    daysLeft,
                    severity: daysLeft <= 7 ? 'critical' : daysLeft <= 15 ? 'warning' : 'info'
                });
            }

            if (visa.emirateIdExpireDate) {
                const daysLeft = dayjs(visa.emirateIdExpireDate).diff(today, 'day');
                alerts.push({
                    id: visa._id.toString(),
                    type: 'Emirates ID Expiry',
                    name: `${visa.employee.firstName} ${visa.employee.lastName}`,
                    date: dayjs(visa.emirateIdExpireDate).format('YYYY-MM-DD'),
                    daysLeft,
                    severity: daysLeft <= 7 ? 'critical' : daysLeft <= 15 ? 'warning' : 'info'
                });
            }

            if (visa.labourExpireDate) {
                const daysLeft = dayjs(visa.labourExpireDate).diff(today, 'day');
                alerts.push({
                    id: visa._id.toString(),
                    type: 'Labour Card Expiry',
                    name: `${visa.employee.firstName} ${visa.employee.lastName}`,
                    date: dayjs(visa.labourExpireDate).format('YYYY-MM-DD'),
                    daysLeft,
                    severity: daysLeft <= 7 ? 'critical' : daysLeft <= 15 ? 'warning' : 'info'
                });
            }
        });

        // Sort by days left (ascending)
        alerts.sort((a, b) => a.daysLeft - b.daysLeft);

        return res.status(200).json(
            new ApiResponse(200, alerts.slice(0, 10), "HR alerts fetched successfully")
        );
    } catch (error) {
        console.error("Error in getHRAlerts:", error);
        throw new ApiError(500, "Failed to fetch HR alerts");
    }
});

// Get top clients
export const getTopClients = asyncHandler(async (req: Request, res: Response) => {
    try {
        const topClients = await Project.aggregate([
            {
                $group: {
                    _id: "$client",
                    projectCount: { $count: {} }
                }
            },
            {
                $sort: { projectCount: -1 }
            },
            {
                $limit: 10
            },
            {
                $lookup: {
                    from: "clients",
                    localField: "_id",
                    foreignField: "_id",
                    as: "client"
                }
            },
            {
                $unwind: "$client"
            }
        ]);

        const result = topClients.map(client => ({
            id: client._id.toString(),
            name: client.client.clientName,
            projects: client.projectCount,
            value: client.projectCount * 100000, // This should be actual project value in real implementation
            status: 'Active'
        }));

        return res.status(200).json(
            new ApiResponse(200, result, "Top clients fetched successfully")
        );
    } catch (error) {
        console.error("Error in getTopClients:", error);
        throw new ApiError(500, "Failed to fetch top clients");
    }
});


export const getPayrollData = asyncHandler(async (req: Request, res: Response) => {
    const { month, year } = req.query;

    if (!month || !year) {
        throw new ApiError(400, "Month and year are required");
    }

    try {
        // Calculate the date range for payroll CREATION
        // If requesting November 2024 payroll, we look for payrolls created in December 2024
        const selectedMonth = parseInt(month as string);
        const selectedYear = parseInt(year as string);

        // Payroll created in the NEXT month
        const payrollCreationMonth = selectedMonth === 12 ? 1 : selectedMonth + 1;
        const payrollCreationYear = selectedMonth === 12 ? selectedYear + 1 : selectedYear;

        const startDate = dayjs(`${payrollCreationYear}-${String(payrollCreationMonth).padStart(2, '0')}-01`)
            .startOf('month')
            .toDate();
        const endDate = dayjs(`${payrollCreationYear}-${String(payrollCreationMonth).padStart(2, '0')}-01`)
            .endOf('month')
            .toDate();

        console.log(`Fetching payroll for ${month}/${year} (created between ${startDate} and ${endDate})`);

        // Get all payroll records created in the specified month
        const payrolls = await Payroll.find({
            createdAt: { $gte: startDate, $lte: endDate }
        })
            .populate('employee', 'firstName lastName role')
            .select('-__v')
            .lean();

        console.log(`Found ${payrolls.length} payroll records`);

        if (!payrolls || payrolls.length === 0) {
            return res.status(200).json(
                new ApiResponse(200, {
                    period: `${month}/${year}`,
                    totalPayroll: 0,
                    averageSalary: 0,
                    overtimeHours: 0,
                    totalEmployees: 0,
                    breakdown: {
                        basicSalary: 0,
                        overtime: 0,
                        allowances: 0,
                        bonuses: 0,
                        transport: 0,
                        medical: 0
                    },
                    deductions: {
                        mess: 0,
                        salaryAdvance: 0,
                        loanDeduction: 0,
                        fineAmount: 0,
                        visaDeduction: 0,
                        totalDeductions: 0
                    },
                    summary: {
                        grossPay: 0,
                        totalDeductions: 0,
                        netPay: 0
                    },
                    payrollByRole: {},
                    recentPayrolls: []
                }, "No payroll data found for this period")
            );
        }

        // Calculate totals
        const totalPayroll = payrolls.reduce((sum, payroll) => sum + (payroll.net || 0), 0);
        const averageSalary = totalPayroll / payrolls.length;

        // Calculate total overtime hours from calculationDetails
        const overtimeHours = payrolls.reduce((sum, payroll) => {
            const regularOT = payroll.calculationDetails?.attendanceSummary?.totalOvertimeHours || 0;
            const sundayOT = payroll.calculationDetails?.attendanceSummary?.sundayOvertimeHours || 0;
            return sum + regularOT + sundayOT;
        }, 0);

        // Calculate breakdown - FIXED to use calculationDetails
        const breakdown = {
            basicSalary: payrolls.reduce((sum, payroll) => {
                return sum + (payroll.calculationDetails?.baseSalaryFromAttendance || 0);
            }, 0) / payrolls.length,

            overtime: payrolls.reduce((sum, payroll) => sum + (payroll.overtime || 0), 0) / payrolls.length,

            allowances: payrolls.reduce((sum, payroll) => {
                // Sunday bonus is part of allowances
                const sundayBonus = payroll.calculationDetails?.sundayBonus || 0;
                return sum + sundayBonus;
            }, 0) / payrolls.length,

            bonuses: payrolls.reduce((sum, payroll) => sum + (payroll.bonus || 0), 0) / payrolls.length,

            transport: payrolls.reduce((sum, payroll) => sum + (payroll.transport || 0), 0) / payrolls.length,

            medical: payrolls.reduce((sum, payroll) => sum + (payroll.medical || 0), 0) / payrolls.length
        };

        // Get deductions summary
        const totalMess = payrolls.reduce((sum, payroll) => sum + (payroll.mess || 0), 0);
        const totalSalaryAdvance = payrolls.reduce((sum, payroll) => sum + (payroll.salaryAdvance || 0), 0);
        const totalLoanDeduction = payrolls.reduce((sum, payroll) => sum + (payroll.loanDeduction || 0), 0);
        const totalFineAmount = payrolls.reduce((sum, payroll) => sum + (payroll.fineAmount || 0), 0);
        const totalVisaDeduction = payrolls.reduce((sum, payroll) => sum + (payroll.visaDeduction || 0), 0);

        const deductions = {
            mess: totalMess,
            salaryAdvance: totalSalaryAdvance,
            loanDeduction: totalLoanDeduction,
            fineAmount: totalFineAmount,
            visaDeduction: totalVisaDeduction,
            totalDeductions: totalMess + totalSalaryAdvance + totalLoanDeduction + totalFineAmount + totalVisaDeduction
        };

        // Get payroll by role
        const payrollByRole = payrolls.reduce((acc, payroll) => {
            const role = (payroll.employee as any)?.role || 'Unknown';
            if (!acc[role]) {
                acc[role] = { count: 0, totalSalary: 0, averageSalary: 0 };
            }
            acc[role].count += 1;
            acc[role].totalSalary += payroll.net || 0;
            return acc;
        }, {} as Record<string, { count: number; totalSalary: number; averageSalary: number }>);

        // Calculate averages for each role
        Object.keys(payrollByRole).forEach(role => {
            payrollByRole[role].averageSalary = payrollByRole[role].totalSalary / payrollByRole[role].count;
        });

        // Get recent payrolls for the table
        const recentPayrolls = payrolls.slice(0, 10).map(payroll => {
            const baseSalary = payroll.calculationDetails?.baseSalaryFromAttendance || 0;
            const sundayBonus = payroll.calculationDetails?.sundayBonus || 0;

            return {
                id: payroll._id,
                employeeName: `${(payroll.employee as any)?.firstName || ''} ${(payroll.employee as any)?.lastName || ''}`.trim(),
                role: (payroll.employee as any)?.role || 'Unknown',
                basicSalary: baseSalary,
                overtime: payroll.overtime || 0,
                allowances: sundayBonus + (payroll.transport || 0) + (payroll.medical || 0),
                deductions: (payroll.mess || 0) +
                    (payroll.salaryAdvance || 0) +
                    (payroll.loanDeduction || 0) +
                    (payroll.fineAmount || 0) +
                    (payroll.visaDeduction || 0),
                netSalary: payroll.net || 0,
                status: 'Paid'
            };
        });

        // Calculate gross pay (net + deductions)
        const grossPay = totalPayroll + deductions.totalDeductions;

        const result = {
            period: `${month}/${year}`,
            totalPayroll,
            averageSalary,
            overtimeHours,
            totalEmployees: payrolls.length,
            breakdown,
            deductions,
            payrollByRole,
            recentPayrolls,
            summary: {
                grossPay,
                totalDeductions: deductions.totalDeductions,
                netPay: totalPayroll
            }
        };

        console.log('Payroll data result:', {
            period: result.period,
            totalEmployees: result.totalEmployees,
            totalPayroll: result.totalPayroll,
            overtimeHours: result.overtimeHours
        });

        return res.status(200).json(
            new ApiResponse(200, result, "Payroll data fetched successfully")
        );
    } catch (error) {
        console.error("Error in getPayrollData:", error);
        throw new ApiError(500, "Failed to fetch payroll data");
    }
});
// Get invoice reports
export const getInvoiceReports = asyncHandler(async (req: Request, res: Response) => {
    const { month, year } = req.query;

    if (!month || !year) {
        throw new ApiError(400, "Month and year are required");
    }

    const startDate = dayjs(`${year}-${month}-01`).startOf('month').toDate();
    const endDate = dayjs(`${year}-${month}-01`).endOf('month').toDate();

    try {
        const invoiceData = await Quotation.aggregate([
            {
                $match: {
                    createdAt: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: null,
                    totalInvoices: { $count: {} },
                    totalAmount: { $sum: "$netAmount" },
                    pendingAmount: {
                        $sum: {
                            $cond: [{ $eq: ["$isApproved", false] }, "$netAmount", 0]
                        }
                    },
                    paidAmount: {
                        $sum: {
                            $cond: [{ $eq: ["$isApproved", true] }, "$netAmount", 0]
                        }
                    }
                }
            }
        ]);

        const result = invoiceData[0] || {
            totalInvoices: 0,
            totalAmount: 0,
            pendingAmount: 0,
            paidAmount: 0
        };

        return res.status(200).json(
            new ApiResponse(200, result, "Invoice reports fetched successfully")
        );
    } catch (error) {
        console.error("Error in getInvoiceReports:", error);
        throw new ApiError(500, "Failed to fetch invoice reports");
    }
});

// Get project profit analytics
export const getProjectProfitAnalytics = asyncHandler(async (req: Request, res: Response) => {
    const { month, year } = req.query;

    const selectedMonth = month ? parseInt(month as string) : dayjs().month() + 1;
    const selectedYear = year ? parseInt(year as string) : dayjs().year();

    try {
        // Helper function to calculate profit for a date range (month)
        const calculateProfitForMonth = async (month: number, year: number) => {
            // Find all budgets that have allocations for the selected month
            const budgets = await Budget.find({
                "monthlyBudgets": {
                    $elemMatch: {
                        month: month,
                        year: year
                    }
                }
            })
                .populate("project", "projectName")
                .populate("quotation", "netAmount");

            if (!budgets.length) {
                return { revenue: 0, expenses: 0, profit: 0, profitMargin: 0 };
            }

            let totalRevenue = 0;
            let totalExpenses = 0;

            const startDate = new Date(year, month - 1, 1);
            const endDate = new Date(year, month, 0, 23, 59, 59);

            for (const budget of budgets) {
                // Get monthly budget allocation (this is our revenue)
                const monthlyBudgetAllocation = budget.monthlyBudgets.find(
                    mb => mb.month === month && mb.year === year
                );

                if (!monthlyBudgetAllocation) continue;

                totalRevenue += monthlyBudgetAllocation.allocatedAmount;

                // Calculate monthly material expenses
                const expenses = await Expense.find({
                    project: budget.project,
                    "materials.date": {
                        $gte: startDate,
                        $lte: endDate
                    }
                });

                const monthlyMaterialExpense = expenses.reduce((total, expense) => {
                    const materialCostForMonth = expense.materials
                        .filter(material => {
                            const materialDate = new Date(material.date);
                            return materialDate >= startDate && materialDate <= endDate;
                        })
                        .reduce((sum, material) => sum + material.amount, 0);

                    return total + materialCostForMonth;
                }, 0);

                totalExpenses += monthlyMaterialExpense;
            }

            const profit = totalRevenue - totalExpenses;
            const profitMargin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;

            return {
                revenue: totalRevenue,
                expenses: totalExpenses,
                profit,
                profitMargin
            };
        };

        // Calculate current month
        const currentMonth = await calculateProfitForMonth(selectedMonth, selectedYear);

        // Calculate previous month
        const prevMonthDate = dayjs(`${selectedYear}-${selectedMonth}-01`).subtract(1, 'month');
        const previousMonth = await calculateProfitForMonth(
            prevMonthDate.month() + 1,
            prevMonthDate.year()
        );

        // Calculate year-to-date (sum of all months from January to current selected month)
        let yearRevenue = 0;
        let yearExpenses = 0;

        for (let m = 1; m <= selectedMonth; m++) {
            const monthData = await calculateProfitForMonth(m, selectedYear);
            yearRevenue += monthData.revenue;
            yearExpenses += monthData.expenses;
        }

        const yearProfit = yearRevenue - yearExpenses;
        const yearProfitMargin = yearRevenue > 0 ? (yearProfit / yearRevenue) * 100 : 0;

        const thisYear = {
            revenue: yearRevenue,
            expenses: yearExpenses,
            profit: yearProfit,
            profitMargin: yearProfitMargin
        };

        // Calculate last year (same period)
        let lastYearRevenue = 0;
        let lastYearExpenses = 0;

        for (let m = 1; m <= selectedMonth; m++) {
            const monthData = await calculateProfitForMonth(m, selectedYear - 1);
            lastYearRevenue += monthData.revenue;
            lastYearExpenses += monthData.expenses;
        }

        const lastYearProfit = lastYearRevenue - lastYearExpenses;
        const lastYearProfitMargin = lastYearRevenue > 0 ? (lastYearProfit / lastYearRevenue) * 100 : 0;

        const lastYear = {
            revenue: lastYearRevenue,
            expenses: lastYearExpenses,
            profit: lastYearProfit,
            profitMargin: lastYearProfitMargin
        };

        // Get profit trend for last 6 months
        const profitTrend = [];
        for (let i = 5; i >= 0; i--) {
            const monthDate = dayjs(`${selectedYear}-${selectedMonth}-01`).subtract(i, 'month');
            const m = monthDate.month() + 1;
            const y = monthDate.year();

            const monthProfit = await calculateProfitForMonth(m, y);
            profitTrend.push({
                month: monthDate.format('MMM YYYY'),
                revenue: monthProfit.revenue,
                expenses: monthProfit.expenses,
                profit: monthProfit.profit,
                profitMargin: monthProfit.profitMargin
            });
        }

        // Get top 5 profitable projects for current month
        const budgets = await Budget.find({
            "monthlyBudgets": {
                $elemMatch: {
                    month: selectedMonth,
                    year: selectedYear
                }
            }
        })
            .populate("project", "projectName")
            .populate({
                path: "project",
                populate: {
                    path: "client",
                    select: "clientName"
                }
            });

        const topProfitableProjects = [];

        const startDate = new Date(selectedYear, selectedMonth - 1, 1);
        const endDate = new Date(selectedYear, selectedMonth, 0, 23, 59, 59);

        for (const budget of budgets) {
            const project = budget.project as any;

            // Get monthly budget allocation
            const monthlyBudgetAllocation = budget.monthlyBudgets.find(
                mb => mb.month === selectedMonth && mb.year === selectedYear
            );

            if (!monthlyBudgetAllocation) continue;

            const revenue = monthlyBudgetAllocation.allocatedAmount;

            // Calculate monthly material expenses
            const expenses = await Expense.find({
                project: project._id,
                "materials.date": {
                    $gte: startDate,
                    $lte: endDate
                }
            });

            const monthlyMaterialExpense = expenses.reduce((total, expense) => {
                const materialCostForMonth = expense.materials
                    .filter(material => {
                        const materialDate = new Date(material.date);
                        return materialDate >= startDate && materialDate <= endDate;
                    })
                    .reduce((sum, material) => sum + material.amount, 0);

                return total + materialCostForMonth;
            }, 0);

            const profit = revenue - monthlyMaterialExpense;
            const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;

            topProfitableProjects.push({
                projectName: project.projectName || 'Unknown Project',
                clientName: project.client?.clientName || 'Unknown Client',
                revenue,
                expenses: monthlyMaterialExpense,
                profit,
                profitMargin
            });
        }

        // Sort by profit descending and take top 5
        topProfitableProjects.sort((a, b) => b.profit - a.profit);
        const top5Projects = topProfitableProjects.slice(0, 5);

        const result = {
            currentMonth,
            previousMonth,
            thisYear,
            lastYear,
            profitTrend,
            topProfitableProjects: top5Projects,
            monthOverMonthChange: {
                revenue: currentMonth.revenue - previousMonth.revenue,
                expenses: currentMonth.expenses - previousMonth.expenses,
                profit: currentMonth.profit - previousMonth.profit,
                profitMargin: currentMonth.profitMargin - previousMonth.profitMargin
            },
            yearOverYearChange: {
                revenue: thisYear.revenue - lastYear.revenue,
                expenses: thisYear.expenses - lastYear.expenses,
                profit: thisYear.profit - lastYear.profit,
                profitMargin: thisYear.profitMargin - lastYear.profitMargin
            }
        };

        console.log('Profit Analytics Result:', {
            currentMonth: result.currentMonth,
            topProjects: result.topProfitableProjects.length
        });

        return res.status(200).json(
            new ApiResponse(200, result, "Project profit analytics fetched successfully")
        );
    } catch (error) {
        console.error("Error in getProjectProfitAnalytics:", error);
        throw new ApiError(500, "Failed to fetch project profit analytics");
    }
});
// Get estimation analytics
export const getEstimationAnalytics = asyncHandler(async (req: Request, res: Response) => {
    const { month, year } = req.query;

    const selectedMonth = month ? parseInt(month as string) : dayjs().month() + 1;
    const selectedYear = year ? parseInt(year as string) : dayjs().year();

    try {
        const currentMonthStart = dayjs(`${selectedYear}-${selectedMonth}-01`).startOf('month').toDate();
        const currentMonthEnd = dayjs(`${selectedYear}-${selectedMonth}-01`).endOf('month').toDate();

        // Get this month's estimation stats
        const monthlyStats = await Estimation.aggregate([
            {
                $match: {
                    createdAt: { $gte: currentMonthStart, $lte: currentMonthEnd }
                }
            },
            {
                $facet: {
                    totalEstimations: [
                        { $count: "count" }
                    ],
                    byStatus: [
                        {
                            $group: {
                                _id: {
                                    $cond: [
                                        { $eq: ["$isApproved", true] },
                                        "Approved",
                                        {
                                            $cond: [
                                                { $eq: ["$isChecked", true] },
                                                "Checked",
                                                "Pending"
                                            ]
                                        }
                                    ]
                                },
                                count: { $count: {} },
                                totalAmount: { $sum: "$estimatedAmount" }
                            }
                        }
                    ],
                    conversionRate: [
                        {
                            $group: {
                                _id: null,
                                total: { $count: {} },
                                converted: {
                                    $sum: {
                                        $cond: [{ $eq: ["$isApproved", true] }, 1, 0]
                                    }
                                }
                            }
                        }
                    ]
                }
            }
        ]);

        // Get yearly estimation stats
        const yearStart = dayjs(`${selectedYear}-01-01`).startOf('year').toDate();
        const yearEnd = dayjs(`${selectedYear}-12-31`).endOf('year').toDate();

        const yearlyStats = await Estimation.aggregate([
            {
                $match: {
                    createdAt: { $gte: yearStart, $lte: yearEnd }
                }
            },
            {
                $facet: {
                    totalEstimations: [
                        { $count: "count" }
                    ],
                    byMonth: [
                        {
                            $group: {
                                _id: { $month: "$createdAt" },
                                count: { $count: {} },
                                totalAmount: { $sum: "$estimatedAmount" },
                                converted: {
                                    $sum: {
                                        $cond: [{ $eq: ["$isApproved", true] }, 1, 0]
                                    }
                                }
                            }
                        },
                        {
                            $sort: { _id: 1 }
                        }
                    ]
                }
            }
        ]);

        // Get top 5 estimations by amount
        const topEstimations = await Estimation.aggregate([
            {
                $match: {
                    createdAt: { $gte: currentMonthStart, $lte: currentMonthEnd }
                }
            },
            {
                $lookup: {
                    from: "projects",
                    localField: "project",
                    foreignField: "_id",
                    as: "project"
                }
            },
            {
                $unwind: "$project"
            },
            {
                $sort: { estimatedAmount: -1 }
            },
            {
                $limit: 5
            },
            {
                $project: {
                    estimationNumber: 1,
                    projectName: "$project.projectName",
                    estimatedAmount: 1,
                    quotationAmount: 1,
                    profit: 1,
                    status: {
                        $cond: [
                            { $eq: ["$isApproved", true] },
                            "Approved",
                            {
                                $cond: [
                                    { $eq: ["$isChecked", true] },
                                    "Checked",
                                    "Pending"
                                ]
                            }
                        ]
                    },
                    preparedDate: "$createdAt"
                }
            }
        ]);

        const result = {
            monthly: {
                total: monthlyStats[0]?.totalEstimations[0]?.count || 0,
                byStatus: monthlyStats[0]?.byStatus || [],
                conversionRate: monthlyStats[0]?.conversionRate[0] ?
                    (monthlyStats[0].conversionRate[0].converted / monthlyStats[0].conversionRate[0].total) * 100 : 0
            },
            yearly: {
                total: yearlyStats[0]?.totalEstimations[0]?.count || 0,
                byMonth: yearlyStats[0]?.byMonth || [],
                conversionRate: yearlyStats[0]?.conversionRate?.[0] ?
                    (yearlyStats[0].conversionRate[0].converted / yearlyStats[0].conversionRate[0].total) * 100 : 0
            },
            topEstimations
        };

        return res.status(200).json(
            new ApiResponse(200, result, "Estimation analytics fetched successfully")
        );
    } catch (error) {
        console.error("Error in getEstimationAnalytics:", error);
        throw new ApiError(500, "Failed to fetch estimation analytics");
    }
});

// Get dashboard summary (combined endpoint for faster loading)
export const getDashboardSummary = asyncHandler(async (req: Request, res: Response) => {
    try {
        const [
            overviewStats,
            projectStatus,
            hrAlerts,
            topClients,
            profitAnalytics,
            estimationAnalytics
        ] = await Promise.all([
            getOverviewStatsData(),
            getProjectStatusData(),
            getHRAlertsData(),
            getTopClientsData(),
            getProjectProfitAnalyticsData(),
            getEstimationAnalyticsData()
        ]);

        const result = {
            overviewStats,
            projectStatus,
            hrAlerts: hrAlerts.slice(0, 5),
            topClients: topClients.slice(0, 5),
            profitAnalytics,
            estimationAnalytics
        };

        return res.status(200).json(
            new ApiResponse(200, result, "Dashboard summary fetched successfully")
        );
    } catch (error) {
        console.error("Error in getDashboardSummary:", error);
        throw new ApiError(500, "Failed to fetch dashboard summary");
    }
});

// Helper functions for getDashboardSummary
async function getOverviewStatsData() {
    const totalProjects = await Project.countDocuments();
    const activeStaff = await User.countDocuments({
        isActive: true,
        role: { $nin: ['super_admin', 'admin', 'finance'] }
    });

    const startOfMonth = dayjs().startOf('month').toDate();
    const endOfMonth = dayjs().endOf('month').toDate();

    // For payroll, we need to look at PREVIOUS month's creation
    // Current month's payroll was created this month, so it's for last month
    const payrollStartDate = startOfMonth;
    const payrollEndDate = endOfMonth;

    const [revenueResult, invoiceResult, payrollResult] = await Promise.all([
        Quotation.aggregate([
            {
                $match: {
                    createdAt: { $gte: startOfMonth, $lte: endOfMonth },
                    isApproved: true
                }
            },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: "$netAmount" }
                }
            }
        ]),
        Quotation.aggregate([
            {
                $match: {
                    createdAt: { $gte: startOfMonth, $lte: endOfMonth }
                }
            },
            {
                $group: {
                    _id: null,
                    totalInvoices: { $count: {} },
                    pendingAmount: {
                        $sum: {
                            $cond: [{ $eq: ["$isApproved", false] }, "$netAmount", 0]
                        }
                    }
                }
            }
        ]),
        Payroll.aggregate([
            {
                $match: {
                    createdAt: { $gte: payrollStartDate, $lte: payrollEndDate }
                }
            },
            {
                $group: {
                    _id: null,
                    totalPayroll: { $sum: "$net" },
                    averageSalary: { $avg: "$net" }
                }
            }
        ])
    ]);

    return {
        totalProjects,
        activeStaff,
        monthlyRevenue: revenueResult[0]?.totalRevenue || 0,
        pendingInvoices: invoiceResult[0]?.totalInvoices || 0,
        pendingInvoiceAmount: invoiceResult[0]?.pendingAmount || 0,
        totalPayroll: payrollResult[0]?.totalPayroll || 0,
        averageSalary: payrollResult[0]?.averageSalary || 0
    };
}

async function getProjectStatusData() {
    const projectStatus = await Project.aggregate([
        {
            $group: {
                _id: "$status",
                count: { $count: {} }
            }
        }
    ]);

    return projectStatus.map(ps => ({
        status: ps._id,
        count: ps.count
    }));
}

async function getHRAlertsData() {
    const today = new Date();
    const thirtyDaysFromNow = dayjs().add(30, 'day').toDate();

    const users = await User.find({
        $or: [
            {
                passportExpiry: {
                    $lte: thirtyDaysFromNow,
                    $gte: today
                }
            },
            {
                emiratesIdExpiry: {
                    $lte: thirtyDaysFromNow,
                    $gte: today
                }
            }
        ]
    }).select('firstName lastName passportExpiry emiratesIdExpiry');

    return users.map(user => {
        let alert = null;
        let daysLeft = 30;

        if (user.passportExpiry) {
            const passportDaysLeft = dayjs(user.passportExpiry).diff(today, 'day');
            if (passportDaysLeft < daysLeft) {
                daysLeft = passportDaysLeft;
                alert = {
                    type: 'Passport Expiry',
                    date: user.passportExpiry
                };
            }
        }

        if (user.emiratesIdExpiry) {
            const emiratesDaysLeft = dayjs(user.emiratesIdExpiry).diff(today, 'day');
            if (emiratesDaysLeft < daysLeft) {
                daysLeft = emiratesDaysLeft;
                alert = {
                    type: 'Emirates ID Expiry',
                    date: user.emiratesIdExpiry
                };
            }
        }

        return {
            id: user._id.toString(),
            type: alert?.type || 'Document Expiry',
            name: `${user.firstName} ${user.lastName}`,
            date: alert?.date ? dayjs(alert.date).format('YYYY-MM-DD') : 'N/A',
            daysLeft,
            severity: daysLeft <= 7 ? 'critical' : daysLeft <= 15 ? 'warning' : 'info'
        };
    });
}

async function getTopClientsData() {
    const topClients = await Project.aggregate([
        {
            $group: {
                _id: "$client",
                projectCount: { $count: {} }
            }
        },
        {
            $sort: { projectCount: -1 }
        },
        {
            $limit: 10
        },
        {
            $lookup: {
                from: "clients",
                localField: "_id",
                foreignField: "_id",
                as: "client"
            }
        },
        {
            $unwind: "$client"
        }
    ]);

    return topClients.map(client => ({
        id: client._id.toString(),
        name: client.client.clientName,
        projects: client.projectCount,
        value: client.projectCount * 100000
    }));
}

async function getProjectProfitAnalyticsData() {
    const currentMonth = dayjs().month() + 1;
    const currentYear = dayjs().year();

    // Helper function to calculate profit for a month
    const calculateProfit = async (month: number, year: number) => {
        const budgets = await Budget.find({
            "monthlyBudgets": {
                $elemMatch: { month, year }
            }
        });

        if (!budgets.length) {
            return { revenue: 0, expenses: 0, profit: 0, profitMargin: 0 };
        }

        let totalRevenue = 0;
        let totalExpenses = 0;

        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);

        for (const budget of budgets) {
            const monthlyBudgetAllocation = budget.monthlyBudgets.find(
                mb => mb.month === month && mb.year === year
            );

            if (!monthlyBudgetAllocation) continue;

            totalRevenue += monthlyBudgetAllocation.allocatedAmount;

            const expenses = await Expense.find({
                project: budget.project,
                "materials.date": { $gte: startDate, $lte: endDate }
            });

            const monthlyMaterialExpense = expenses.reduce((total, expense) => {
                const materialCostForMonth = expense.materials
                    .filter(material => {
                        const materialDate = new Date(material.date);
                        return materialDate >= startDate && materialDate <= endDate;
                    })
                    .reduce((sum, material) => sum + material.amount, 0);
                return total + materialCostForMonth;
            }, 0);

            totalExpenses += monthlyMaterialExpense;
        }

        const profit = totalRevenue - totalExpenses;
        return {
            revenue: totalRevenue,
            expenses: totalExpenses,
            profit,
            profitMargin: totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0
        };
    };

    const prevMonthDate = dayjs().subtract(1, 'month');

    const [currentMonthResult, previousMonthResult] = await Promise.all([
        calculateProfit(currentMonth, currentYear),
        calculateProfit(prevMonthDate.month() + 1, prevMonthDate.year())
    ]);

    return {
        currentMonth: currentMonthResult,
        previousMonth: previousMonthResult,
        monthOverMonthChange: {
            profit: currentMonthResult.profit - previousMonthResult.profit,
            profitMargin: currentMonthResult.profitMargin - previousMonthResult.profitMargin
        }
    };
}
async function getEstimationAnalyticsData() {
    const startOfMonth = dayjs().startOf('month').toDate();
    const endOfMonth = dayjs().endOf('month').toDate();

    const stats = await Estimation.aggregate([
        {
            $match: {
                createdAt: { $gte: startOfMonth, $lte: endOfMonth }
            }
        },
        {
            $group: {
                _id: null,
                total: { $count: {} },
                pending: {
                    $sum: {
                        $cond: [
                            { $and: [{ $eq: ["$isChecked", false] }, { $eq: ["$isApproved", false] }] },
                            1,
                            0
                        ]
                    }
                },
                checked: {
                    $sum: {
                        $cond: [
                            { $and: [{ $eq: ["$isChecked", true] }, { $eq: ["$isApproved", false] }] },
                            1,
                            0
                        ]
                    }
                },
                approved: {
                    $sum: {
                        $cond: [{ $eq: ["$isApproved", true] }, 1, 0]
                    }
                }
            }
        }
    ]);

    return stats[0] || { total: 0, pending: 0, checked: 0, approved: 0 };
}

async function calculateProfitForRange(startDate: Date, endDate: Date) {
    const [revenueResult, expenseResult] = await Promise.all([
        Quotation.aggregate([
            {
                $match: {
                    createdAt: { $gte: startDate, $lte: endDate },
                    isApproved: true
                }
            },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: "$netAmount" }
                }
            }
        ]),
        Expense.aggregate([
            {
                $match: {
                    createdAt: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: null,
                    totalExpenses: {
                        $sum: {
                            $add: [
                                "$totalMaterialCost",
                                "$totalMiscellaneousCost",
                                "$laborDetails.totalLaborCost"
                            ]
                        }
                    }
                }
            }
        ])
    ]);

    const revenue = revenueResult[0]?.totalRevenue || 0;
    const expenses = expenseResult[0]?.totalExpenses || 0;
    const profit = revenue - expenses;

    return {
        revenue,
        expenses,
        profit,
        profitMargin: revenue > 0 ? (profit / revenue) * 100 : 0
    };
}