import 'package:flutter/foundation.dart';
import 'package:youtube_explode_dart/youtube_explode_dart.dart';
import '../models/track.dart';

/// Service for YouTube audio stream extraction
class YouTubeService {
  final YoutubeExplode _yt = YoutubeExplode();

  /// Search YouTube for a track and return best matching video ID
  Future<String?> findVideoId(Track track) async {
    try {
      final query = '${track.title} ${track.artist}';
      debugPrint('[YT] Searching: "$query"');
      final results = await _yt.search.search(query);

      debugPrint('[YT] Found ${results.length} results');
      if (results.isEmpty) return null;

      // Score matching - prefer videos with similar duration
      Video? bestMatch;
      int bestScore = -1;

      for (final video in results.take(5)) {
        int score = 0;

        // Title contains track name
        final titleLower = video.title.toLowerCase();
        if (titleLower.contains(track.title.toLowerCase())) score += 10;
        if (titleLower.contains(track.artist.toLowerCase())) score += 5;

        // Duration matching (within 10 seconds)
        if (track.durationMs != null && video.duration != null) {
          final diff = (video.duration!.inMilliseconds - track.durationMs!).abs();
          if (diff < 10000) score += 20;
          else if (diff < 30000) score += 10;
          else if (diff < 60000) score += 5;
        }

        // Penalize if "live", "remix", "cover" unless original has it
        if (titleLower.contains('live') &&
            !track.title.toLowerCase().contains('live')) {
          score -= 10;
        }
        if (titleLower.contains('remix') &&
            !track.title.toLowerCase().contains('remix')) {
          score -= 10;
        }

        debugPrint('[YT]   "${video.title}" score=$score dur=${video.duration}');

        if (score > bestScore) {
          bestScore = score;
          bestMatch = video;
        }
      }

      final result = bestMatch?.id.value ?? results.first.id.value;
      debugPrint('[YT] Best match: $result');
      return result;
    } catch (e, st) {
      debugPrint('[YT] Search error: $e');
      debugPrint('[YT] Stack: $st');
      return null;
    }
  }

  /// Get direct audio stream URL for a YouTube video
  Future<String?> getAudioStreamUrl(String videoId) async {
    try {
      debugPrint('[YT] Getting manifest for: $videoId');
      final manifest = await _yt.videos.streamsClient.getManifest(
        VideoId(videoId),
      );

      // Get highest quality audio-only stream
      final audioStreams = manifest.audioOnly.sortByBitrate();
      debugPrint('[YT] Found ${audioStreams.length} audio streams');

      if (audioStreams.isEmpty) {
        debugPrint('[YT] No audio-only streams, trying muxed...');
        final muxedStreams = manifest.muxed.sortByBitrate();
        if (muxedStreams.isEmpty) {
          debugPrint('[YT] No muxed streams either!');
          return null;
        }
        final url = muxedStreams.last.url.toString();
        debugPrint('[YT] Using muxed stream: ${url.substring(0, 80)}...');
        return url;
      }

      // Prefer medium-quality for faster loading (128kbps area)
      AudioOnlyStreamInfo selected;
      if (audioStreams.length > 2) {
        // Pick middle quality for balance
        selected = audioStreams[audioStreams.length ~/ 2];
      } else {
        selected = audioStreams.last;
      }

      debugPrint('[YT] Selected: ${selected.codec} ${selected.bitrate} ${selected.size}');
      final url = selected.url.toString();
      debugPrint('[YT] Stream URL: ${url.substring(0, 80)}...');
      return url;
    } catch (e, st) {
      debugPrint('[YT] Stream error: $e');
      debugPrint('[YT] Stack: $st');
      return null;
    }
  }

  /// Get audio stream info (for download with progress)
  Future<StreamInfo?> getAudioStreamInfo(String videoId) async {
    try {
      final manifest = await _yt.videos.streamsClient.getManifest(
        VideoId(videoId),
      );

      final audioStreams = manifest.audioOnly.sortByBitrate();
      if (audioStreams.isEmpty) return null;

      return audioStreams.last;
    } catch (e) {
      debugPrint('[YT] StreamInfo error: $e');
      return null;
    }
  }

  /// Get raw audio stream (for downloading)
  Stream<List<int>> getAudioStream(StreamInfo streamInfo) {
    return _yt.videos.streamsClient.get(streamInfo);
  }

  void dispose() {
    _yt.close();
  }
}
