import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../application/employee_providers.dart';
import 'dot_app_bar.dart';
import 'widgets.dart';

/// The More tab: the screens that are not in the bottom bar.
class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unread = snapshotOf(ref.watch(notificationsProvider)).data?.unreadCount ?? 0;
    return Scaffold(
      appBar: const DotAppBar(),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          ListCard(
            title: 'Notice period',
            subtitle: 'Your current notice and history',
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/notice'),
          ),
          ListCard(
            title: 'Notifications',
            subtitle: unread == 0 ? 'Nothing new' : '$unread unread',
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/notifications'),
          ),
          ListCard(
            title: 'Profile',
            subtitle: 'Your details and sign out',
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/profile'),
          ),
        ],
      ),
    );
  }
}
