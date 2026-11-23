import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// Bottom navigation for the four tabs in the current app (Home, Attendance, Leaves, Salary) plus More.
/// Each branch keeps its state when the user switches tabs, so returning to a tab does not reload it.
class ShellScaffold extends StatelessWidget {
  const ShellScaffold({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: navigationShell.currentIndex,
        onDestinationSelected: (index) => navigationShell.goBranch(
          index,
          initialLocation: index == navigationShell.currentIndex,
        ),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Home'),
          NavigationDestination(
              icon: Icon(Icons.access_time_outlined), selectedIcon: Icon(Icons.access_time_filled), label: 'Attendance'),
          NavigationDestination(
              icon: Icon(Icons.event_note_outlined), selectedIcon: Icon(Icons.event_note), label: 'Leaves'),
          NavigationDestination(
              icon: Icon(Icons.payments_outlined), selectedIcon: Icon(Icons.payments), label: 'Salary'),
          NavigationDestination(icon: Icon(Icons.more_horiz), selectedIcon: Icon(Icons.more_horiz), label: 'More'),
        ],
      ),
    );
  }
}
