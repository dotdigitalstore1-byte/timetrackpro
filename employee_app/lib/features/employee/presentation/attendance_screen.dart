import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/format/formatters.dart';
import '../application/employee_providers.dart';
import '../data/models/attendance_model.dart';
import 'dot_app_bar.dart';
import 'widgets.dart';

/// Attendance for one salary cycle at a time. The cycle counts come from the server, the same numbers payroll uses.
class AttendanceScreen extends ConsumerStatefulWidget {
  const AttendanceScreen({super.key});

  @override
  ConsumerState<AttendanceScreen> createState() => _AttendanceScreenState();
}

class _AttendanceScreenState extends ConsumerState<AttendanceScreen> {
  /// Null means the current cycle.
  String? _month;

  @override
  Widget build(BuildContext context) {
    final current = snapshotOf(ref.watch(attendanceProvider(null)));
    final currentKey = current.data?.month;
    final snap = snapshotOf(ref.watch(attendanceProvider(_month)));

    return Scaffold(
      appBar: const DotAppBar(),
      body: ResourceList<AttendanceData>(
        snapshot: snap,
        onRefresh: () async {
          ref.invalidate(attendanceProvider(_month));
          ref.invalidate(attendanceProvider(null));
        },
        children: (d) => [
          _CycleNav(
            label: '${formatDayMonth(d.periodStart)} – ${formatDateKey(d.periodEnd)}',
            canGoBack: currentKey != null,
            canGoForward: _month != null,
            onBack: () => setState(() => _month = shiftMonthKey(_month ?? currentKey!, -1)),
            onForward: () => setState(() {
              final next = shiftMonthKey(_month!, 1);
              _month = next == currentKey ? null : next;
            }),
          ),
          StatGrid(
            tiles: [
              StatTile(label: 'On time', value: '${d.summary.present}', color: const Color(0xFF15803D)),
              StatTile(label: 'Late', value: '${d.summary.late}', color: const Color(0xFFB45309)),
              StatTile(label: 'Half day', value: '${d.summary.half}', color: const Color(0xFFB45309)),
              StatTile(label: 'Absent', value: '${d.summary.absent}', color: const Color(0xFFB91C1C)),
              StatTile(label: 'On leave', value: '${d.summary.leave}', color: const Color(0xFF1D4ED8)),
            ],
          ),
          const SizedBox(height: 12),
          if (d.restricted)
            const InfoCard(child: Text('Older attendance is hidden by your company. Today is shown.')),
          if (d.days.isEmpty && !d.restricted) const EmptyNote(text: 'No days in this cycle yet.'),
          for (final day in d.days) _DayTile(day: day),
        ],
      ),
    );
  }
}

class _CycleNav extends StatelessWidget {
  const _CycleNav({
    required this.label,
    required this.canGoBack,
    required this.canGoForward,
    required this.onBack,
    required this.onForward,
  });

  final String label;
  final bool canGoBack;
  final bool canGoForward;
  final VoidCallback onBack;
  final VoidCallback onForward;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        children: [
          IconButton(
            tooltip: 'Previous cycle',
            onPressed: canGoBack ? onBack : null,
            icon: const Icon(Icons.chevron_left),
          ),
          Expanded(
            child: Text(label, textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleSmall),
          ),
          IconButton(
            tooltip: 'Next cycle',
            onPressed: canGoForward ? onForward : null,
            icon: const Icon(Icons.chevron_right),
          ),
        ],
      ),
    );
  }
}

class _DayTile extends StatelessWidget {
  const _DayTile({required this.day});

  final CalendarDay day;

  @override
  Widget build(BuildContext context) {
    final rec = day.record;
    final details = <String>[];
    if (rec?.punchIn != null) details.add('In ${formatTime(rec!.punchIn!)}');
    if (rec?.punchOut != null) details.add('Out ${formatTime(rec!.punchOut!)}');
    if (rec == null && day.note.isNotEmpty) details.add(day.note);

    return ListCard(
      title: '${day.weekday}, ${formatDayMonth(day.date)}',
      subtitle: details.isEmpty ? null : details.join('  ·  '),
      trailing: rec != null
          ? StatusChip(status: rec.status)
          : Text(day.label, style: Theme.of(context).textTheme.bodySmall),
    );
  }
}
