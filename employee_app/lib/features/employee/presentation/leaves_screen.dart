import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/format/formatters.dart';
import '../application/employee_providers.dart';
import '../data/models/leave_model.dart';
import 'widgets.dart';

class LeavesScreen extends ConsumerWidget {
  const LeavesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final snap = snapshotOf(ref.watch(leavesProvider));
    return Scaffold(
      appBar: AppBar(title: const Text('Leaves')),
      body: ResourceList<LeavesData>(
        snapshot: snap,
        onRefresh: () async => ref.invalidate(leavesProvider),
        children: (d) => [
          if (d.balance == null)
            const EmptyNote(text: 'Leave balance is not available for your account.')
          else
            _BalanceCard(balance: d.balance!),
          const SizedBox(height: 4),
          Text('Your requests', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          if (d.leaves.isEmpty) const EmptyNote(text: 'You have not requested any leave yet.'),
          for (final leave in d.leaves) _LeaveTile(leave: leave),
          const EmptyNote(text: "Requesting leave isn't available in the app yet."),
        ],
      ),
    );
  }
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({required this.balance});

  final LeaveBalance balance;

  @override
  Widget build(BuildContext context) {
    final rule = balance.mode == 'lapse'
        ? 'Unused leave lapses at the end of each month.'
        : 'Unused leave carries over through the year.';
    return InfoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: StatTile(
                  label: 'Left to use',
                  value: formatDays(balance.remaining),
                  color: const Color(0xFF15803D),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(child: StatTile(label: 'Pending', value: formatDays(balance.pending))),
            ],
          ),
          const SizedBox(height: 8),
          KeyValueRow(label: 'Accrued', value: '${formatDays(balance.quota)} days'),
          KeyValueRow(label: 'Used', value: '${formatDays(balance.used)} days'),
          const SizedBox(height: 4),
          Text(rule, style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
    );
  }
}

class _LeaveTile extends StatelessWidget {
  const _LeaveTile({required this.leave});

  final LeaveRequest leave;

  @override
  Widget build(BuildContext context) {
    final dates = leave.startDate == leave.endDate
        ? formatDateKey(leave.startDate)
        : '${formatDateKey(leave.startDate)} – ${formatDateKey(leave.endDate)}';
    final lines = <String>[
      '$dates · ${formatDays(leave.days)} day(s)',
      if (leave.reason != null && leave.reason!.isNotEmpty) leave.reason!,
      if (leave.status == 'rejected' && leave.rejectionReason != null) 'Reason: ${leave.rejectionReason}',
    ];
    return ListCard(
      title: humanize(leave.leaveType),
      subtitle: lines.join('\n'),
      trailing: StatusChip(status: leave.status),
    );
  }
}
