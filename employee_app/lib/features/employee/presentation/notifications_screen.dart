import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/format/formatters.dart';
import '../application/employee_providers.dart';
import '../data/models/notification_model.dart';
import 'widgets.dart';

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final snap = snapshotOf(ref.watch(notificationsProvider));
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: ResourceList<NotificationsData>(
        snapshot: snap,
        onRefresh: () async => ref.invalidate(notificationsProvider),
        children: (d) {
          if (d.items.isEmpty) return const [EmptyNote(text: "You're all caught up.")];
          return [for (final n in d.items) _NotificationTile(item: n)];
        },
      ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile({required this.item});

  final NotificationItem item;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final dotColor = switch (item.tone) {
      'red' => const Color(0xFFB91C1C),
      'amber' => const Color(0xFFB45309),
      'indigo' => const Color(0xFF4F46E5),
      _ => scheme.outline,
    };
    final when = item.at == null ? '' : formatDateTime(item.at!);
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(
            color: item.unread ? dotColor : Colors.transparent,
            shape: BoxShape.circle,
          ),
        ),
        title: Text(
          item.title,
          style: TextStyle(fontWeight: item.unread ? FontWeight.w700 : FontWeight.w400),
        ),
        subtitle: Text(item.body.isEmpty ? when : '${item.body}\n$when'),
        isThreeLine: item.body.isNotEmpty,
      ),
    );
  }
}
