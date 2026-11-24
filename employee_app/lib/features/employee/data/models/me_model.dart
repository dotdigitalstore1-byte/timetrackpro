import '../../../../core/format/json_read.dart';

/// The signed-in employee's profile, from GET /api/auth/me.
class MeData {
  const MeData({
    required this.userId,
    required this.fullName,
    required this.email,
    required this.phone,
    required this.role,
    required this.companyName,
    required this.employeeCode,
    required this.designation,
    required this.departmentLabel,
    required this.locations,
    required this.shiftStart,
    required this.shiftEnd,
    required this.basicSalary,
    required this.currency,
  });

  final String userId;
  final String fullName;
  final String email;
  final String? phone;
  final String role;
  final String? companyName;
  final String? employeeCode;
  final String? designation;
  final String? departmentLabel;
  final List<String> locations;
  final String? shiftStart;
  final String? shiftEnd;
  final double? basicSalary;
  final String currency;

  String get firstName {
    final parts = fullName.trim().split(RegExp(r'\s+'));
    return parts.isEmpty || parts.first.isEmpty ? fullName : parts.first;
  }

  String get initials {
    final parts = fullName.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return (parts.first.substring(0, 1) + parts.last.substring(0, 1)).toUpperCase();
  }

  factory MeData.fromJson(Map<String, dynamic> json) {
    final user = readMap(json['user']);
    final company = readMap(json['company']);
    final settings = readMap(json['settings']);
    final employee = readMap(json['employee']);
    return MeData(
      userId: readStringOr(user['id'], ''),
      fullName: readStringOr(user['fullName'], ''),
      email: readStringOr(user['email'], ''),
      phone: readString(user['phone']),
      role: readStringOr(user['role'], 'employee'),
      companyName: readString(company['name']),
      employeeCode: readString(employee['employeeCode']),
      designation: readString(employee['designation']),
      departmentLabel: readString(employee['department']),
      locations: readList(employee['locations'])
          .map((l) => readStringOr(l['name'], ''))
          .where((n) => n.isNotEmpty)
          .toList(),
      shiftStart: readString(employee['shiftStart']),
      shiftEnd: readString(employee['shiftEnd']),
      basicSalary: readNumOrNull(employee['basicSalary']),
      currency: readStringOr(settings['currency'], 'INR'),
    );
  }
}
