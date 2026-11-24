import 'package:flutter_test/flutter_test.dart';

import 'package:dotinout_employee/core/format/formatters.dart';

void main() {
  test('money groups the Indian way and keeps two decimals', () {
    expect(formatMoney(1234567, 'INR'), '₹12,34,567.00');
    expect(formatMoney(0, 'INR'), '₹0.00');
    expect(formatMoney(-500.5, 'INR'), '-₹500.50');
    expect(formatMoney(18450, 'USD'), r'$18,450.00');
  });

  test('day counts drop the decimal when whole', () {
    expect(formatDays(2), '2');
    expect(formatDays(2.5), '2.5');
    expect(formatDays(0), '0');
  });

  test('salary-cycle keys move by whole months across years', () {
    expect(shiftMonthKey('2026-01', -1), '2025-12');
    expect(shiftMonthKey('2026-12', 1), '2027-01');
    expect(shiftMonthKey('2026-11', -3), '2026-08');
    expect(formatCycleKey('2026-11'), 'Nov 2026');
  });

  test('times and shift clocks read naturally', () {
    expect(formatTime(DateTime(2026, 11, 23, 9, 5)), '9:05 AM');
    expect(formatTime(DateTime(2026, 11, 23, 12, 30)), '12:30 PM');
    expect(formatTime(DateTime(2026, 11, 23, 0, 0)), '12:00 AM');
    expect(formatShiftClock('09:30'), '9:30 AM');
    expect(formatShiftClock('18:00'), '6:00 PM');
    expect(formatShiftClock(null), '—');
  });

  test('dates format from keys and fall back to the input', () {
    expect(formatDateKey('2026-11-23'), '23 Nov 2026');
    expect(formatDayMonth('2026-11-03'), '3 Nov');
    expect(formatDateKey(null), '—');
    expect(formatDateKey('not a date'), 'not a date');
  });

  test('statuses read as sentences and greetings follow the hour', () {
    expect(humanize('half_day'), 'Half day');
    expect(humanize('on_leave'), 'On leave');
    expect(greetingFor(9), 'Good morning');
    expect(greetingFor(13), 'Good afternoon');
    expect(greetingFor(20), 'Good evening');
  });
}
