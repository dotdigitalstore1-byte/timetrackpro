"use client";

import { useCallback, useEffect, useState } from "react";
import { api, downloadBlob, toCSV, useMe } from "@/lib/client";
import { Button, Card, EmptyState, ErrorBanner, Input, PageHeader, Select, Spinner } from "@/components/ui";
import EmployeePicker from "@/components/EmployeePicker";

interface ReportRow {
  [key: string]: unknown;
}

export default function ReportsPage() {
  const { me } = useMe();
  const isAdmin = me?.user.role === "company_admin";

  const [report, setReport] = useState("attendance");
  const [period, setPeriod] = useState("monthly");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [employeeId, setEmployeeId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [employees, setEmployees] = useState<{ id: string; fullName: string; employeeCode?: string | null }[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState("");

  const buildQs = useCallback(
    (format?: string) => {
      const qs = new URLSearchParams({ report, period, date });
      if (employeeId) qs.set("employeeId", employeeId);
      if (departmentId) qs.set("departmentId", departmentId);
      if (format) qs.set("format", format);
      return qs;
    },
    [report, period, date, employeeId, departmentId]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = buildQs();
      const data = await api<{ rows: ReportRow[]; count: number }>(`/api/reports?${qs}`);
      setRows(data.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load report");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [buildQs]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // Filters for admins and for managers with view_reports (the server limits managers to their team).
    if (employees.length === 0) {
      api<{ employees: { id: string; fullName: string }[] }>("/api/employees")
        .then((d) => setEmployees(d.employees))
        .catch(() => setEmployees([]));
    }
  }, [employees.length]);

  useEffect(() => {
    api<{ departments: { id: string; name: string }[] }>("/api/departments")
      .then((d) => setDepartments(d.departments))
      .catch(() => setDepartments([]));
  }, []);

  const exportCSV = async () => {
    setExporting("csv");
    try {
      const res = await fetch(`/api/reports?${buildQs("csv")}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error("Export failed");
      downloadBlob(await res.text(), `${report}-report.csv`, "text/csv");
    } catch {
      // fall back to the rows already on screen
      if (rows.length) downloadBlob(toCSV(rows), `${report}-report.csv`, "text/csv");
      else setError("CSV export failed. Please try again.");
    } finally {
      setExporting("");
    }
  };

  const exportExcel = async () => {
    setExporting("xlsx");
    try {
      const res = await fetch(`/api/reports?${buildQs("xlsx")}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error("Export failed");
      downloadBlob(await res.blob(), `${report}-report.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } catch {
      setError("Excel export failed. Please try again.");
    } finally {
      setExporting("");
    }
  };

  const exportPDF = async () => {
    setExporting("pdf");
    try {
      const { jsPDF } = await import("jspdf");
      const autoTable = (await import("jspdf-autotable")).default;
      const doc = new jsPDF({ orientation: "landscape" });
      doc.setFontSize(16);
      doc.text(`${report.toUpperCase()} Report — ${period}`, 14, 16);
      doc.setFontSize(10);
      doc.text(`Generated ${new Date().toLocaleString()} · ${me?.company?.name ?? ""}`, 14, 23);
      if (rows.length === 0) {
        doc.text("No data.", 14, 32);
      } else {
        autoTable(doc, {
          startY: 28,
          head: [Object.keys(rows[0])],
          body: rows.map((r) => Object.values(r).map((v) => String(v ?? ""))),
          styles: { fontSize: 8 },
          headStyles: { fillColor: [79, 70, 229] },
        });
      }
      doc.save(`${report}-report.pdf`);
    } finally {
      setExporting("");
    }
  };

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Daily, weekly, monthly and yearly reports — export to Excel, CSV or PDF"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" loading={exporting === "xlsx"} onClick={exportExcel}>⬇ Excel</Button>
            <Button variant="secondary" size="sm" loading={exporting === "csv"} onClick={exportCSV}>⬇ CSV</Button>
            <Button variant="secondary" size="sm" loading={exporting === "pdf"} onClick={exportPDF}>⬇ PDF</Button>
          </div>
        }
      />

      <Card className="mb-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select
            label="Report"
            value={report}
            onChange={setReport}
            options={[
              { value: "attendance", label: "Attendance" },
              { value: "late", label: "Late Attendance" },
              { value: "leave", label: "Leaves" },
              ...(isAdmin ? [{ value: "salary", label: "Salary" }, { value: "deduction", label: "Deductions" }] : []),
            ]}
          />
          <Select
            label="Period"
            value={period}
            onChange={setPeriod}
            options={[
              { value: "daily", label: "Daily" },
              { value: "weekly", label: "Weekly" },
              { value: "monthly", label: "Monthly" },
              { value: "yearly", label: "Yearly" },
            ]}
          />
          <Input label="Date (period anchor)" type="date" value={date} onChange={setDate} />
          <Select
            label="Department"
            value={departmentId}
            onChange={setDepartmentId}
            options={[{ value: "", label: "All departments" }, ...departments.map((d) => ({ value: d.id, label: d.name }))]}
          />
          <EmployeePicker
            label="Employee"
            value={employeeId}
            onChange={setEmployeeId}
            allLabel="All employees"
            items={employees.map((e) => ({ id: e.id, name: e.fullName, code: e.employeeCode }))}
          />
        </div>
      </Card>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : error ? (
        <ErrorBanner message={error} onRetry={load} />
      ) : rows.length === 0 ? (
        <EmptyState message="No data for the selected filters." />
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="border-b border-slate-100 bg-slate-50 uppercase tracking-wide text-slate-500">
                <tr>
                  {Object.keys(rows[0]).map((h) => (
                    <th key={h} className="px-3 py-2.5 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map((r, i) => (
                  <tr key={i}>
                    {Object.values(r).map((v, j) => (
                      <td key={j} className="px-3 py-2.5 text-slate-600">{String(v ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">{rows.length} row(s)</p>
          </Card>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {rows.map((r, i) => (
              <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Row {i + 1}</p>
                <dl className="space-y-1.5">
                  {Object.entries(r).map(([key, value]) => (
                    <div key={key} className="flex items-start justify-between gap-3 text-xs">
                      <dt className="shrink-0 text-slate-400">{key}</dt>
                      <dd className="text-right font-semibold text-slate-700">{String(value ?? "—")}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
            <p className="text-center text-xs text-slate-400">{rows.length} row(s)</p>
          </div>
        </>
      )}
    </div>
  );
}