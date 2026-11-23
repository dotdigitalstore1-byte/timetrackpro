import 'package:flutter/material.dart';

/// Stand-in for a tab until its M2 screen is built. Keeps the navigation testable from day one.
class PlaceholderScreen extends StatelessWidget {
  const PlaceholderScreen({super.key, required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: Center(child: Text('$title arrives in milestone M2.')),
    );
  }
}
