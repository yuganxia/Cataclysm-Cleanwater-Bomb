#version 450

layout(set = 1, binding = 0) uniform PrecipUBO {
    mat4 view_proj;
    vec4 eye_pos;
    vec4 volume_center;  // xyz = scene-space center, w = horizontal half extent
    vec4 volume_params;  // x = minimum relative z, y = maximum relative z, z = aspect
    vec4 wind;           // xy = world direction, z = normalized speed, w = seconds
    vec4 precipitation;  // x = rain, y = snow, z = mode (0 rain, 1 snow), w = daylight
    vec4 mask_mapping;
    vec4 cam_right;
    vec4 cam_up;
    vec4 height_mapping;
};

layout(location = 0) out vec3 v_world;
layout(location = 1) out vec2 v_uv;
layout(location = 2) out float v_alpha;

vec4 precipitation_hash( float id )
{
    return vec4(
               fract( sin( id * 12.9898 ) * 43758.5453 ),
               fract( sin( id * 78.2330 ) * 24634.6345 ),
               fract( sin( id * 39.4250 ) * 56445.2341 ),
               fract( sin( id * 93.9890 ) * 35714.5729 ) );
}

void main()
{
    const vec2 corners[6] = vec2[](
        vec2( -1.0, 0.0 ), vec2( 1.0, 0.0 ), vec2( 1.0, 1.0 ),
        vec2( -1.0, 0.0 ), vec2( 1.0, 1.0 ), vec2( -1.0, 1.0 ) );
    int mode = int( precipitation.z + 0.5 );
    float id = float( gl_InstanceIndex ) + 1.0 + float( mode ) * 10007.0;
    vec4 random = precipitation_hash( id );
    vec2 flow = dot( wind.xy, wind.xy ) > 1.0e-6 ? normalize( wind.xy ) : vec2( 0.0 );
    float time = wind.w;
    float half_extent = volume_center.w;
    float span = half_extent * 2.0;
    float drift_speed = mode == 0 ? 1.4 + wind.z * 5.0 : 0.22 + wind.z * 1.25;
    vec2 base_xy = ( random.xy * 2.0 - 1.0 ) * half_extent;
    vec2 local_xy = mod( base_xy + flow * time * drift_speed + half_extent, span ) - half_extent;
    if( mode == 1 ) {
        local_xy += vec2( sin( time * 0.83 + random.z * 6.2831853 ),
                          cos( time * 0.67 + random.w * 6.2831853 ) ) * 0.38;
    }
    float fall_speed = mode == 0 ? mix( 7.0, 11.0, random.w ) : mix( 0.65, 1.25, random.w );
    float z_range = volume_params.y - volume_params.x;
    float initial_z = mix( volume_params.x, volume_params.y, random.z );
    float local_z = volume_params.y - mod( volume_params.y - initial_z + time * fall_speed, z_range );
    vec3 center = volume_center.xyz + vec3( local_xy, local_z );
    vec2 corner = corners[gl_VertexIndex];
    vec3 world;
    if( mode == 0 ) {
        vec3 axis = normalize( vec3( -flow * ( 0.16 + wind.z * 0.52 ), 1.0 ) );
        vec3 side_raw = cross( axis, eye_pos.xyz - center );
        vec3 side = dot( side_raw, side_raw ) > 1.0e-6 ? normalize( side_raw ) : cam_right.xyz;
        float streak_length = mix( 0.32, 0.80, random.z );
        float width = mix( 0.007, 0.015, random.w );
        world = center + axis * ( corner.y * streak_length ) + side * ( corner.x * width );
        v_uv = vec2( corner.x * 0.5 + 0.5, corner.y );
        v_alpha = mix( 0.16, 0.32, random.w );
    } else {
        corner.y = corner.y * 2.0 - 1.0;
        float size = mix( 0.045, 0.11, random.w );
        world = center + cam_right.xyz * ( corner.x * size ) + cam_up.xyz * ( corner.y * size );
        v_uv = corner * 0.5 + 0.5;
        v_alpha = mix( 0.45, 0.80, random.w );
    }
    float distance_to_eye = length( eye_pos.xyz - center );
    v_alpha *= smoothstep( 0.8, 2.0, distance_to_eye ) *
               ( 1.0 - smoothstep( 24.0, 42.0, distance_to_eye ) );
    v_world = world;
    gl_Position = view_proj * vec4( world, 1.0 );
}
