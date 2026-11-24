import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/cache/stale_while_revalidate.dart';
import '../../../core/format/formatters.dart';
import '../../../core/theme/brand.dart';

/// The snapshot a screen shows for a provider. Before the first value arrives it is empty, so the screen shows
/// placeholders rather than a spinner.
Snapshot<T> snapshotOf<T>(AsyncValue<Snapshot<T>> value) {
  if (value.hasValue) return value.requireValue;
  if (value.hasError) return Snapshot<T>(error: 'Could not load this screen. Please try again.');
  return Snapshot<T>();
}

/// A slim notice above the content when the data shown is saved data (offline, or the refresh failed).
class SnapshotStatus extends StatelessWidget {
  const SnapshotStatus({super.key, required this.snapshot});

  final Snapshot<dynamic> snapshot;

  @override
  Widget build(BuildContext context) {
    final s = snapshot;
    if (!s.hasData || s.error == null) return const SizedBox.shrink();
    final scheme = Theme.of(context).colorScheme;
    final saved = s.savedAt == null ? '' : ' Showing data saved ${formatDateTime(s.savedAt!)}.';
    final message = s.offline ? "You're offline.$saved" : "Couldn't refresh.$saved";
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(color: scheme.secondaryContainer, borderRadius: BorderRadius.circular(12)),
      child: Row(
        children: [
          Icon(
            s.offline ? Icons.cloud_off_outlined : Icons.sync_problem_outlined,
            size: 18,
            color: scheme.onSecondaryContainer,
          ),
          const SizedBox(width: 8),
          Expanded(child: Text(message, style: TextStyle(color: scheme.onSecondaryContainer))),
        ],
      ),
    );
  }
}

/// A full-screen list. Shows cached data at once and refreshes silently. Pull down to refresh.
class ResourceList<T> extends StatelessWidget {
  const ResourceList({super.key, required this.snapshot, required this.onRefresh, required this.children});

  final Snapshot<T> snapshot;
  final Future<void> Function() onRefresh;
  final List<Widget> Function(T data) children;

  @override
  Widget build(BuildContext context) {
    final data = snapshot.data;
    final List<Widget> items;
    if (data != null) {
      items = [SnapshotStatus(snapshot: snapshot), ...children(data)];
    } else if (snapshot.error != null) {
      items = [ErrorCard(message: snapshot.error!, onRetry: onRefresh)];
    } else {
      items = List<Widget>.generate(3, (_) => const SkeletonBlock());
    }
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: items,
      ),
    );
  }
}

/// One block of a screen (for example the Home page's leave card). Shows a placeholder until its data arrives.
class ResourceSection<T> extends StatelessWidget {
  const ResourceSection({super.key, required this.snapshot, required this.builder, this.placeholderHeight = 96});

  final Snapshot<T> snapshot;
  final Widget Function(T data) builder;
  final double placeholderHeight;

  @override
  Widget build(BuildContext context) {
    final data = snapshot.data;
    if (data != null) return builder(data);
    if (snapshot.error != null) return ErrorCard(message: snapshot.error!);
    return SkeletonBlock(height: placeholderHeight);
  }
}

class ErrorCard extends StatelessWidget {
  const ErrorCard({super.key, required this.message, this.onRetry});

  final String message;
  final Future<void> Function()? onRetry;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(message),
            if (onRetry != null) ...[
              const SizedBox(height: 12),
              FilledButton.tonal(
                onPressed: () {
                  onRetry!();
                },
                child: const Text('Try again'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// A grey placeholder shape. Used instead of a spinner while the first data loads.
class SkeletonBlock extends StatelessWidget {
  const SkeletonBlock({super.key, this.height = 84});

  final double height;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: height,
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(16),
      ),
    );
  }
}

class InfoCard extends StatelessWidget {
  const InfoCard({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(padding: const EdgeInsets.all(16), child: child),
    );
  }
}

class StatTile extends StatelessWidget {
  const StatTile({super.key, required this.label, required this.value, this.color});

  final String label;
  final String value;

  /// Small colour dot before the label, as the web's stat cards use a tinted badge.
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              value,
              style: text.headlineSmall?.copyWith(fontWeight: FontWeight.w700, color: DotColors.slate900),
            ),
            const SizedBox(height: 4),
            Row(
              children: [
                if (color != null) ...[
                  Container(width: 8, height: 8, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
                  const SizedBox(width: 6),
                ],
                Flexible(
                  child: Text(
                    label,
                    overflow: TextOverflow.ellipsis,
                    style: text.bodySmall?.copyWith(color: DotColors.slate500, fontWeight: FontWeight.w500),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Counts in a grid: two columns on phones, more on wide screens.
class StatGrid extends StatelessWidget {
  const StatGrid({super.key, required this.tiles});

  final List<StatTile> tiles;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = constraints.maxWidth >= 600 ? tiles.length : 2;
        return GridView.count(
          crossAxisCount: columns,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 8,
          crossAxisSpacing: 8,
          childAspectRatio: 1.7,
          children: tiles,
        );
      },
    );
  }
}

Color statusColor(BuildContext context, String status) {
  final scheme = Theme.of(context).colorScheme;
  return switch (status) {
    'present' || 'approved' || 'finalized' || 'paid' || 'active' || 'completed' => const Color(0xFF15803D),
    'late' || 'half_day' || 'pending' || 'requested' || 'draft' => const Color(0xFFB45309),
    'absent' || 'rejected' || 'withdrawn' => const Color(0xFFB91C1C),
    'on_leave' || 'leave' => const Color(0xFF1D4ED8),
    _ => scheme.onSurfaceVariant,
  };
}

class StatusChip extends StatelessWidget {
  const StatusChip({super.key, required this.status, this.label});

  final String status;

  /// Overrides the text shown for [status].
  final String? label;

  @override
  Widget build(BuildContext context) {
    final color = statusColor(context, status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: color.withAlpha(36), borderRadius: BorderRadius.circular(999)),
      child: Text(
        label ?? humanize(status),
        style: TextStyle(color: color, fontWeight: FontWeight.w600, fontSize: 12),
      ),
    );
  }
}

class KeyValueRow extends StatelessWidget {
  const KeyValueRow({super.key, required this.label, required this.value, this.emphasize = false});

  final String label;
  final String value;
  final bool emphasize;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            flex: 2,
            child: Text(label, style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant)),
          ),
          const SizedBox(width: 12),
          Expanded(
            flex: 3,
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: emphasize ? text.titleMedium?.copyWith(fontWeight: FontWeight.w700) : text.bodyMedium,
            ),
          ),
        ],
      ),
    );
  }
}

class EmptyNote extends StatelessWidget {
  const EmptyNote({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Text(
        text,
        textAlign: TextAlign.center,
        style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
      ),
    );
  }
}

/// A card row for a list item, such as a day, a leave request or a notice.
class ListCard extends StatelessWidget {
  const ListCard({super.key, required this.title, this.subtitle, this.trailing, this.onTap});

  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        title: Text(title),
        subtitle: subtitle == null ? null : Text(subtitle!),
        trailing: trailing,
        onTap: onTap,
      ),
    );
  }
}
