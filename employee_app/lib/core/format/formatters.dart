const _monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// "2026-11-23" becomes "23 Nov 2026". Unreadable input is returned as it is.
String formatDateKey(String? key) {
  if (key == null || key.isEmpty) return '—';
  final d = DateTime.tryParse(key);
  if (d == null) return key;
  return '${d.day} ${_monthNames[d.month - 1]} ${d.year}';
}

/// "2026-11-23" becomes "23 Nov".
String formatDayMonth(String? key) {
  if (key == null || key.isEmpty) return '—';
  final d = DateTime.tryParse(key);
  if (d == null) return key;
  return '${d.day} ${_monthNames[d.month - 1]}';
}

/// 2026, 11 becomes "Nov 2026".
String formatMonthYear(int year, int month) => '${_monthNames[month - 1]} $year';

/// 9:05 AM style, from a local time.
String formatTime(DateTime t) {
  var h = t.hour % 12;
  if (h == 0) h = 12;
  final m = t.minute.toString().padLeft(2, '0');
  return '$h:$m ${t.hour < 12 ? 'AM' : 'PM'}';
}

/// "23 Nov, 9:05 AM".
String formatDateTime(DateTime t) => '${t.day} ${_monthNames[t.month - 1]}, ${formatTime(t)}';

/// Moves a salary-cycle key "YYYY-MM" by whole months.
String shiftMonthKey(String key, int delta) {
  final parts = key.split('-');
  var year = int.parse(parts[0]);
  var month = int.parse(parts[1]) + delta;
  while (month < 1) {
    month += 12;
    year -= 1;
  }
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  return '$year-${month.toString().padLeft(2, '0')}';
}

/// Amounts with the currency symbol, grouped the Indian way (12,34,567.00). The server's money is already rounded.
String formatMoney(double amount, String currency) {
  final symbol = switch (currency) {
    'INR' => '₹',
    'USD' => r'$',
    'EUR' => '€',
    'GBP' => '£',
    _ => '$currency ',
  };
  final negative = amount < 0;
  final fixed = amount.abs().toStringAsFixed(2);
  final dot = fixed.indexOf('.');
  final grouped = groupIndian(int.parse(fixed.substring(0, dot)));
  return '${negative ? '-' : ''}$symbol$grouped${fixed.substring(dot)}';
}

/// 1234567 becomes "12,34,567".
String groupIndian(int n) {
  final s = n.toString();
  if (s.length <= 3) return s;
  final last3 = s.substring(s.length - 3);
  var rest = s.substring(0, s.length - 3);
  final parts = <String>[];
  while (rest.length > 2) {
    parts.insert(0, rest.substring(rest.length - 2));
    rest = rest.substring(0, rest.length - 2);
  }
  if (rest.isNotEmpty) parts.insert(0, rest);
  return '${parts.join(',')},$last3';
}

/// "half_day" becomes "Half day".
String humanize(String value) {
  final spaced = value.replaceAll('_', ' ').trim();
  if (spaced.isEmpty) return spaced;
  return spaced[0].toUpperCase() + spaced.substring(1);
}

/// "09:30" becomes "9:30 AM". Anything else is returned as it is.
String formatShiftClock(String? hhmm) {
  if (hhmm == null) return '—';
  final parts = hhmm.split(':');
  if (parts.length < 2) return hhmm;
  final h = int.tryParse(parts[0]);
  final m = int.tryParse(parts[1]);
  if (h == null || m == null) return hhmm;
  final suffix = h < 12 ? 'AM' : 'PM';
  var display = h % 12;
  if (display == 0) display = 12;
  return '$display:${m.toString().padLeft(2, '0')} $suffix';
}

/// Greeting for the hour of the day (local time).
String greetingFor(int hour) {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const _weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/// "Mon, 23 Nov" for the greeting line.
String formatLongDate(DateTime d) => '${_weekdayNames[d.weekday - 1]}, ${d.day} ${_monthNames[d.month - 1]}';

/// 2 becomes "2", 2.5 becomes "2.5".
String formatDays(num value) {
  if (value == value.roundToDouble()) return value.toInt().toString();
  return value.toStringAsFixed(1);
}

/// "2026-11" becomes "Nov 2026". Anything else is returned as it is.
String formatCycleKey(String key) {
  final parts = key.split('-');
  if (parts.length < 2) return key;
  final year = int.tryParse(parts[0]);
  final month = int.tryParse(parts[1]);
  if (year == null || month == null || month < 1 || month > 12) return key;
  return formatMonthYear(year, month);
}
