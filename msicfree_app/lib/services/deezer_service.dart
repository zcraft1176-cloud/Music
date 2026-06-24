import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/track.dart';

/// Service for Deezer API (metadata, search, cover art)
class DeezerService {
  static const String _baseUrl = 'https://api.deezer.com';

  /// Search tracks by query
  Future<List<Track>> searchTracks(String query, {int limit = 20}) async {
    try {
      final url = Uri.parse('$_baseUrl/search?q=${Uri.encodeComponent(query)}&limit=$limit');
      final response = await http.get(url);

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        final List items = data['data'] ?? [];
        return items.map((item) => Track.fromDeezer(item)).toList();
      }
    } catch (e) {
      // Silently fail, return empty
    }
    return [];
  }

  /// Get trending/chart tracks
  Future<List<Track>> getTrending({int limit = 20}) async {
    try {
      final url = Uri.parse('$_baseUrl/chart/0/tracks?limit=$limit');
      final response = await http.get(url);

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        final List items = data['data'] ?? [];
        return items.map((item) => Track.fromDeezer(item)).toList();
      }
    } catch (e) {
      // Silently fail
    }
    return [];
  }

  /// Get tracks by genre
  Future<List<Track>> getByGenre(int genreId, {int limit = 20}) async {
    try {
      final url = Uri.parse('$_baseUrl/chart/$genreId/tracks?limit=$limit');
      final response = await http.get(url);

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        final List items = data['data'] ?? [];
        return items.map((item) => Track.fromDeezer(item)).toList();
      }
    } catch (e) {
      // Silently fail
    }
    return [];
  }

  /// Get available genres
  Future<List<Map<String, dynamic>>> getGenres() async {
    try {
      final url = Uri.parse('$_baseUrl/genre');
      final response = await http.get(url);

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        final List items = data['data'] ?? [];
        return items
            .where((g) => g['id'] != 0)
            .map<Map<String, dynamic>>((g) => {
                  'id': g['id'],
                  'name': g['name'],
                  'picture': g['picture_medium'] ?? g['picture'],
                })
            .toList();
      }
    } catch (e) {
      // Silently fail
    }
    return [];
  }
}
