import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/format/formatters.dart';
import '../../auth/application/session_controller.dart';
import '../application/employee_providers.dart';
import '../data/models/me_model.dart';
import 'widgets.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final snap = snapshotOf(ref.watch(meProvider));
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ResourceList<MeData>(
        snapshot: snap,
        onRefresh: () async => ref.invalidate(meProvider),
        children: (d) => [
          Center(
            child: Column(
              children: [
                CircleAvatar(
                  radius: 36,
                  child: Text(d.initials, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
                ),
                const SizedBox(height: 12),
                Text(d.fullName, style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
                if (d.designation != null) Text(d.designation!, style: Theme.of(context).textTheme.bodyMedium),
                if (d.employeeCode != null) Text('ID ${d.employeeCode}', style: Theme.of(context).textTheme.bodySmall),
              ],
            ),
          ),
          const SizedBox(height: 16),
          InfoCard(
            child: Column(
              children: [
                if (d.companyName != null) KeyValueRow(label: 'Company', value: d.companyName!),
                if (d.departmentLabel != null && d.departmentLabel!.isNotEmpty)
                  KeyValueRow(label: 'Department', value: d.departmentLabel!),
                if (d.locations.isNotEmpty) KeyValueRow(label: 'Location', value: d.locations.join(', ')),
                KeyValueRow(
                  label: 'Shift',
                  value: '${formatShiftClock(d.shiftStart)} – ${formatShiftClock(d.shiftEnd)}',
                ),
                KeyValueRow(label: 'Email', value: d.email),
                if (d.phone != null && d.phone!.isNotEmpty) KeyValueRow(label: 'Phone', value: d.phone!),
                if (d.basicSalary != null)
                  KeyValueRow(label: 'Basic salary', value: formatMoney(d.basicSalary!, d.currency)),
              ],
            ),
          ),
          const SizedBox(height: 8),
          FilledButton.tonal(
            onPressed: () => ref.read(sessionProvider.notifier).signOut(),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
  }
}
