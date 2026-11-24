import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/format/formatters.dart';
import '../application/employee_providers.dart';
import '../data/models/salary_model.dart';
import 'widgets.dart';

/// Salary for one cycle. Every figure comes from the server's calculation. The app shows it and does not recalculate it.
class SalaryScreen extends ConsumerStatefulWidget {
  const SalaryScreen({super.key});

  @override
  ConsumerState<SalaryScreen> createState() => _SalaryScreenState();
}

class _SalaryScreenState extends ConsumerState<SalaryScreen> {
  /// Null means the current cycle.
  String? _month;

  @override
  Widget build(BuildContext context) {
    final current = snapshotOf(ref.watch(salaryProvider(null)));
    final currentKey = current.data?.currentKey;
    final snap = snapshotOf(ref.watch(salaryProvider(_month)));
    final currency = snapshotOf(ref.watch(meProvider)).data?.currency ?? 'INR';
    final selectedKey = _month ?? currentKey;

    return Scaffold(
      appBar: AppBar(title: const Text('Salary')),
      body: ResourceList<SalaryData>(
        snapshot: snap,
        onRefresh: () async {
          ref.invalidate(salaryProvider(_month));
          ref.invalidate(salaryProvider(null));
        },
        children: (d) {
          final b = d.breakdown;
          final isEstimate = d.status == 'preview';
          return [
            if (d.cycles.isNotEmpty && selectedKey != null && d.cycles.any((c) => c.key == selectedKey))
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: DropdownButton<String>(
                  isExpanded: true,
                  value: selectedKey,
                  items: [
                    for (final c in d.cycles)
                      DropdownMenuItem<String>(value: c.key, child: Text(formatCycleKey(c.key))),
                  ],
                  onChanged: (key) {
                    if (key == null) return;
                    setState(() => _month = key == currentKey ? null : key);
                  },
                ),
              ),
            InfoCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    isEstimate ? 'Estimated net pay' : 'Net pay',
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    formatMoney(b?.netPayable ?? 0, currency),
                    style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      StatusChip(status: d.status, label: isEstimate ? 'Estimate' : humanize(d.status)),
                    ],
                  ),
                  const SizedBox(height: 8),
                  KeyValueRow(
                    label: isEstimate ? 'Expected on' : 'Paid on',
                    value: formatDateKey(d.disbursementDate),
                  ),
                  if (isEstimate)
                    Text(
                      'The final amount is set when payroll is saved for this cycle.',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                ],
              ),
            ),
            if (b != null) _BreakdownCard(b: b, currency: currency),
            for (final hold in d.holds) _HoldCard(hold: hold, currency: currency),
            const SizedBox(height: 4),
            Text(
              'Previous salaries',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            if (d.history.isEmpty) const EmptyNote(text: 'No saved salaries yet.'),
            for (final h in d.history)
              ListCard(
                title: formatMonthYear(h.year, h.month),
                subtitle: '${h.status == 'paid' ? 'Paid on' : 'Pay date'} ${formatDateKey(h.disbursementDate)}',
                trailing: Text(
                  formatMoney(h.netPayable, currency),
                  style: Theme.of(context).textTheme.titleSmall,
                ),
              ),
          ];
        },
      ),
    );
  }
}

class _BreakdownCard extends StatelessWidget {
  const _BreakdownCard({required this.b, required this.currency});

  final SalaryBreakdown b;
  final String currency;

  @override
  Widget build(BuildContext context) {
    return InfoCard(
      child: Column(
        children: [
          KeyValueRow(label: 'Basic salary', value: formatMoney(b.basicSalary, currency)),
          KeyValueRow(label: 'Attendance-based pay', value: formatMoney(b.attendanceSalary, currency)),
          if (b.additionsTotal != 0) KeyValueRow(label: 'Additions', value: formatMoney(b.additionsTotal, currency)),
          if (b.overtimePay != 0) KeyValueRow(label: 'Overtime', value: formatMoney(b.overtimePay, currency)),
          KeyValueRow(label: 'Deductions', value: formatMoney(b.totalAllDeductions, currency)),
          const Divider(height: 24),
          KeyValueRow(label: 'Present days', value: formatDays(b.presentDays)),
          KeyValueRow(label: 'Late days', value: formatDays(b.lateDays)),
          KeyValueRow(label: 'Half days', value: formatDays(b.halfDays)),
          KeyValueRow(label: 'Absent days', value: formatDays(b.absentDays)),
          KeyValueRow(label: 'Leave days', value: formatDays(b.leaveDays)),
          if (b.unapprovedLeaveCount > 0)
            KeyValueRow(label: 'Unapproved leave', value: '${b.unapprovedLeaveCount}'),
        ],
      ),
    );
  }
}

class _HoldCard extends StatelessWidget {
  const _HoldCard({required this.hold, required this.currency});

  final SalaryHold hold;
  final String currency;

  @override
  Widget build(BuildContext context) {
    return InfoCard(
      child: Column(
        children: [
          KeyValueRow(label: 'On hold', value: formatMoney(hold.amount, currency), emphasize: true),
          KeyValueRow(label: 'Reason', value: 'Unapproved leave (${hold.unapprovedDays} day(s))'),
        ],
      ),
    );
  }
}
