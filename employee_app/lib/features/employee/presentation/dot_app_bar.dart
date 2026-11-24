import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/brand.dart';
import '../../auth/application/session_controller.dart';
import '../application/employee_providers.dart';
import 'widgets.dart';

/// Header for the tabs, laid out as the web's mobile header: brand mark, company and user name, profile and sign-out.
class DotAppBar extends ConsumerWidget implements PreferredSizeWidget {
  const DotAppBar({super.key, this.actions = const []});

  /// Extra buttons shown before the profile button.
  final List<Widget> actions;

  @override
  Size get preferredSize => const Size.fromHeight(64);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = snapshotOf(ref.watch(meProvider)).data;
    final textTheme = Theme.of(context).textTheme;
    return AppBar(
      automaticallyImplyLeading: false,
      titleSpacing: 16,
      toolbarHeight: 64,
      title: Row(
        children: [
          const BrandMark(size: 32),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  me?.companyName ?? 'Dotinout',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700, color: DotColors.slate900),
                ),
                if (me != null)
                  Text(
                    me.fullName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 10, color: DotColors.slate400),
                  ),
              ],
            ),
          ),
        ],
      ),
      actions: [
        ...actions,
        InkWell(
          customBorder: const CircleBorder(),
          onTap: () => context.push('/profile'),
          child: Container(
            width: 36,
            height: 36,
            alignment: Alignment.center,
            margin: const EdgeInsets.symmetric(horizontal: 4),
            decoration: const BoxDecoration(color: DotColors.indigo50, shape: BoxShape.circle),
            child: Text(
              me?.initials ?? '?',
              style: const TextStyle(color: DotColors.indigo700, fontSize: 12, fontWeight: FontWeight.w700),
            ),
          ),
        ),
        IconButton(
          tooltip: 'Sign out',
          onPressed: () => ref.read(sessionProvider.notifier).signOut(),
          icon: const Icon(Icons.logout, color: DotColors.slate400),
        ),
      ],
    );
  }
}
