class Track {
  final String id;
  final String title;
  final String artist;
  final String? album;
  final String? coverUrl;
  final int? durationMs;
  final String? youtubeId;
  final String? previewUrl;

  const Track({
    required this.id,
    required this.title,
    required this.artist,
    this.album,
    this.coverUrl,
    this.durationMs,
    this.youtubeId,
    this.previewUrl,
  });

  String get durationFormatted {
    if (durationMs == null) return '--:--';
    final totalSeconds = durationMs! ~/ 1000;
    final minutes = totalSeconds ~/ 60;
    final seconds = totalSeconds % 60;
    return '$minutes:${seconds.toString().padLeft(2, '0')}';
  }

  /// From Deezer API JSON
  factory Track.fromDeezer(Map<String, dynamic> json) {
    final albumData = json['album'] as Map<String, dynamic>?;
    final artistData = json['artist'] as Map<String, dynamic>?;

    return Track(
      id: json['id'].toString(),
      title: json['title'] ?? 'Unknown',
      artist: artistData?['name'] ?? json['artist']?['name'] ?? 'Unknown',
      album: albumData?['title'],
      coverUrl: albumData?['cover_big'] ??
          albumData?['cover_medium'] ??
          albumData?['cover'],
      durationMs: json['duration'] != null
          ? (json['duration'] as int) * 1000
          : null,
      previewUrl: json['preview'],
    );
  }

  /// From Firestore document (sync with web)
  factory Track.fromFirestore(Map<String, dynamic> json) {
    return Track(
      id: json['id']?.toString() ?? '',
      title: json['title'] ?? 'Unknown',
      artist: json['artist'] ?? 'Unknown',
      album: json['album'],
      coverUrl: json['coverUrl'] ?? json['cover'],
      durationMs: json['durationMs'] ?? json['duration'],
      youtubeId: json['youtubeId'],
    );
  }

  /// To Firestore document (compatible with web version)
  Map<String, dynamic> toFirestore() {
    return {
      'id': id,
      'title': title,
      'artist': artist,
      if (album != null) 'album': album,
      if (coverUrl != null) 'coverUrl': coverUrl,
      if (durationMs != null) 'durationMs': durationMs,
      if (youtubeId != null) 'youtubeId': youtubeId,
    };
  }

  Track copyWith({
    String? id,
    String? title,
    String? artist,
    String? album,
    String? coverUrl,
    int? durationMs,
    String? youtubeId,
    String? previewUrl,
  }) {
    return Track(
      id: id ?? this.id,
      title: title ?? this.title,
      artist: artist ?? this.artist,
      album: album ?? this.album,
      coverUrl: coverUrl ?? this.coverUrl,
      durationMs: durationMs ?? this.durationMs,
      youtubeId: youtubeId ?? this.youtubeId,
      previewUrl: previewUrl ?? this.previewUrl,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) || other is Track && id == other.id;

  @override
  int get hashCode => id.hashCode;
}
