import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/format/formatters.dart';
import '../application/employee_providers.dart';
import '../data/models/attendance_model.dart';
import '../data/models/leave_model.dart';
import '../data/models/me_model.dart';
import '../data/models/notice_model.dart';
import 'dot_app_bar.dart';
import 'widgets.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = snapshotOf(ref.watch(meProvider));
    final att = snapshotOf(ref.watch(attendanceProvider(null)));
    final leaves = snapshotOf(ref.watch(leavesProvider));
    final notice = snapshotOf(ref.watch(noticeProvider));
    final unread = snapshotOf(ref.watch(notificationsProvider)).data?.unreadCount ?? 0;
    final shownStatus = att.error != null ? att : me;

    Future<void> refresh() async {
      ref.invalidate(meProvider);
      ref.invalidate(attendanceProvider(null));
      ref.invalidate(leavesProvider);
      ref.invalidate(noticeProvider);
      ref.invalidate(notificationsProvider);
    }

    final now = DateTime.now();
    final currentNotice = notice.data?.current;

    return Scaffold(
      appBar: DotAppBar(
        actions: [
          IconButton(
            tooltip: 'Notifications',
            onPressed: () => context.push('/notifications'),
            icon: Badge(
              isLabelVisible: unread > 0,
              label: Text('$unread'),
              child: const Icon(Icons.notifications_outlined),
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: refresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: [
            SnapshotStatus(snapshot: shownStatus),
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${greetingFor(now.hour)}${me.data == null ? '' : ', ${me.data!.firstName}'}',
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 2),
                  Text(formatLongDate(now), style: Theme.of(context).textTheme.bodyMedium),
                ],
              ),
            ),
            ResourceSection<AttendanceData>(
              snapshot: att,
              placeholderHeight: 150,
              builder: (data) => _TodayCard(data: data, me: me.data),
            ),
            if (currentNotice != null && currentNotice.status == 'active') _NoticeBanner(notice: currentNotice),
            ResourceSection<AttendanceData>(
              snapshot: att,
              placeholderHeight: 180,
              builder: (data) => _CycleCard(data: data),
            ),
            ResourceSection<LeavesData>(
              snapshot: leaves,
              placeholderHeight: 120,
              builder: (data) => _LeaveCard(data: data),
            ),
          ],
        ),
      ),
    );
  }
}

class _TodayCard extends StatelessWidget {
  const _TodayCard({required this.data, required this.me});

  final AttendanceData data;
  final MeData? me;

  @override
  Widget build(BuildContext context) {
    final record = data.recordOn(data.today);
    final day = data.dayOn(data.today);
    final punchIn = record?.punchIn;
    final punchOut = record?.punchOut;
    final text = Theme.of(context).textTheme;

    return InfoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text('Today', style: text.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
              const Spacer(),
              if (record != null) StatusChip(status: record.status),
            ],
          ),
          const SizedBox(height: 8),
          if (punchIn != null)
            KeyValueRow(label: 'Punched in', value: formatTime(punchIn))
          else
            Text(
              day == null || day.note.isEmpty ? 'Not punched in yet' : day.note,
              style: text.bodyMedium,
            ),
          if (punchOut != null) KeyValueRow(label: 'Punched out', value: formatTime(punchOut)),
          if (me != null)
            KeyValueRow(
              label: 'Shift',
              value: '${formatShiftClock(me!.shiftStart)} – ${formatShiftClock(me!.shiftEnd)}',
            ),
        ],
      ),
    );
  }
}

class _CycleCard extends StatelessWidget {
  const _CycleCard({required this.data});

  final AttendanceData data;

  @override
  Widget build(BuildContext context) {
    final s = data.summary;
    final text = Theme.of(context).textTheme;
    final period = '${formatDayMonth(data.periodStart)} – ${formatDateKey(data.periodEnd)}';
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('This salary cycle', style: text.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
          Text(period, style: text.bodySmall),
          const SizedBox(height: 10),
          StatGrid(
            tiles: [
              StatTile(label: 'On time', value: '${s.present}', color: const Color(0xFF15803D)),
              StatTile(label: 'Late', value: '${s.late}', color: const Color(0xFFB45309)),
              StatTile(label: 'Half day', value: '${s.half}', color: const Color(0xFFB45309)),
              StatTile(label: 'Absent', value: '${s.absent}', color: const Color(0xFFB91C1C)),
              StatTile(label: 'On leave', value: '${s.leave}', color: const Color(0xFF1D4ED8)),
            ],
          ),
        ],
      ),
    );
  }
}

class _LeaveCard extends StatelessWidget {
  const _LeaveCard({required this.data});

  final LeavesData data;

  @override
  Widget build(BuildContext context) {
    final b = data.balance;
    if (b == null) return const SizedBox.shrink();
    return InfoCard(
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Leave left', style: Theme.of(context).textTheme.bodyMedium),
                Text(
                  '${formatDays(b.remaining)} days',
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
                ),
              ],
            ),
          ),
          Text(
            b.pending > 0 ? '${formatDays(b.pending)} day(s) pending' : 'Nothing pending',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}

class _NoticeBanner extends StatelessWidget {
  const _NoticeBanner({required this.notice});

  final NoticeItem notice;

  @override
  Widget build(BuildContext context) {
    final days = notice.daysLeft;
    return InfoCard(
      child: Row(
        children: [
          const Icon(Icons.event_busy_outlined),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              days == null
                  ? 'Notice period in progress. Last working day ${formatDateKey(notice.lastWorkingDay)}.'
                  : 'Notice period: $days days left. Last working day ${formatDateKey(notice.lastWorkingDay)}.',
            ),
          ),
        ],
      ),
    );
  }
}
