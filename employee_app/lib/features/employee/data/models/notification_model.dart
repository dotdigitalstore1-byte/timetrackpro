import '../../../../core/format/json_read.dart';

class NotificationItem {
  const NotificationItem({
    required this.id,
    required this.kind,
    required this.title,
    required this.body,
    required this.at,
    required this.unread,
    required this.tone,
  });

  final String id;
  final String kind;
  final String title;
  final String body;
  final DateTime? at;
  final bool unread;

  /// amber | red | indigo (and any other tone the server adds: shown as neutral)
  final String tone;

  factory NotificationItem.fromJson(Map<String, dynamic> json) => NotificationItem(
        id: readStringOr(json['id'], ''),
        kind: readStringOr(json['kind'], ''),
        title: readStringOr(json['title'], ''),
        body: readStringOr(json['body'], ''),
        at: instantOf(json['at']),
        unread: readBool(json['unread']),
        tone: readStringOr(json['tone'], ''),
      );
}

class NotificationsData {
  const NotificationsData({required this.items, required this.unreadCount});

  final List<NotificationItem> items;
  final int unreadCount;

  factory NotificationsData.fromJson(Map<String, dynamic> json) => NotificationsData(
        items: readList(json['items']).map(NotificationItem.fromJson).toList(),
        unreadCount: readInt(json['unreadCount']),
      );
}
