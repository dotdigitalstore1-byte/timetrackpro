import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/format/formatters.dart';
import '../application/employee_providers.dart';
import '../data/models/notice_model.dart';
import 'widgets.dart';

class NoticeScreen extends ConsumerWidget {
  const NoticeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final snap = snapshotOf(ref.watch(noticeProvider));
    return Scaffold(
      appBar: AppBar(title: const Text('Notice period')),
      body: ResourceList<NoticeData>(
        snapshot: snap,
        onRefresh: () async => ref.invalidate(noticeProvider),
        children: (d) {
          final c = d.current;
          return [
            if (c == null)
              const EmptyNote(text: 'You have no open notice period.')
            else
              InfoCard(
                child: Column(
                  children: [
                    Row(
                      children: [
                        Text('Current notice', style: Theme.of(context).textTheme.titleMedium),
                        const Spacer(),
                        StatusChip(status: c.status),
                      ],
                    ),
                    const SizedBox(height: 8),
                    if (c.daysLeft != null && c.status == 'active') KeyValueRow(label: 'Days left', value: '${c.daysLeft}'),
                    KeyValueRow(label: 'Notice period', value: c.noticeDays == null ? '—' : '${c.noticeDays} days'),
                    KeyValueRow(label: 'Start date', value: formatDateKey(c.startDate)),
                    KeyValueRow(label: 'Last working day', value: formatDateKey(c.lastWorkingDay)),
                    if (c.reason != null && c.reason!.isNotEmpty) KeyValueRow(label: 'Reason', value: c.reason!),
                    if (c.decisionNote != null && c.decisionNote!.isNotEmpty)
                      KeyValueRow(label: 'Note from manager', value: c.decisionNote!),
                  ],
                ),
              ),
            const SizedBox(height: 4),
            Text(
              'History',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            if (d.history.isEmpty) const EmptyNote(text: 'No notice periods yet.'),
            for (final h in d.history)
              ListCard(
                title: 'Started ${formatDateKey(h.startDate)}',
                subtitle: 'Last working day ${formatDateKey(h.lastWorkingDay)}',
                trailing: StatusChip(status: h.status),
              ),
            const EmptyNote(text: "Requesting a notice period isn't available in the app yet."),
          ];
        },
      ),
    );
  }
}
