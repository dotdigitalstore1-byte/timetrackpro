import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../application/session_controller.dart';

/// Employee sign-in. Same copy and rules as the web's employee sign-in in the mobile app: no forgot-password link,
/// because employees ask their company admin to reset it.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _identifier = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _identifier.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final error = await ref
        .read(sessionProvider.notifier)
        .signIn(identifier: _identifier.text, password: _password.text);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = error;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      backgroundColor: const Color(0xFF4F46E5),
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            return SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
              child: ConstrainedBox(
                constraints: BoxConstraints(minHeight: constraints.maxHeight - 48),
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 420),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Text(
                          'Dio',
                          style: TextStyle(color: Colors.white, fontSize: 40, fontWeight: FontWeight.w900),
                        ),
                        const SizedBox(height: 24),
                        Card(
                          child: Padding(
                            padding: const EdgeInsets.all(20),
                            child: Form(
                              key: _formKey,
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  Text('Employee sign in', style: theme.textTheme.titleLarge),
                                  const SizedBox(height: 16),
                                  TextFormField(
                                    controller: _identifier,
                                    enabled: !_busy,
                                    keyboardType: TextInputType.emailAddress,
                                    autocorrect: false,
                                    textInputAction: TextInputAction.next,
                                    autofillHints: const [AutofillHints.username],
                                    decoration: const InputDecoration(labelText: 'Email ID or username'),
                                    validator: (v) =>
                                        (v == null || v.trim().isEmpty) ? 'Enter your email ID or username' : null,
                                  ),
                                  const SizedBox(height: 12),
                                  TextFormField(
                                    controller: _password,
                                    enabled: !_busy,
                                    obscureText: true,
                                    textInputAction: TextInputAction.done,
                                    autofillHints: const [AutofillHints.password],
                                    onFieldSubmitted: (_) => _submit(),
                                    decoration: const InputDecoration(labelText: 'Password'),
                                    validator: (v) => (v == null || v.isEmpty) ? 'Enter your password' : null,
                                  ),
                                  if (_error != null) ...[
                                    const SizedBox(height: 12),
                                    Semantics(
                                      liveRegion: true,
                                      child: Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
                                    ),
                                  ],
                                  const SizedBox(height: 16),
                                  FilledButton(
                                    onPressed: _busy ? null : _submit,
                                    child: _busy
                                        ? const SizedBox(
                                            height: 20,
                                            width: 20,
                                            child: CircularProgressIndicator(strokeWidth: 2),
                                          )
                                        : const Text('Sign in'),
                                  ),
                                  const SizedBox(height: 12),
                                  Text(
                                    'Forgot your password? Contact your company admin to reset it.',
                                    textAlign: TextAlign.center,
                                    style: theme.textTheme.bodySmall,
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
