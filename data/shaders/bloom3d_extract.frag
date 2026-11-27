#version 450

layout(set = 2, binding = 0) uniform sampler2D scene_tex;
layout(set = 2, binding = 1) uniform sampler2D emissive_tex;
layout(set = 2, binding = 2) uniform sampler2D sun_spill_tex;

layout(set = 3, binding = 0) uniform BloomExtractUBO {
    vec4 sun_spill_params; // x = enabled, y = gain
};

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 out_color;

void main()
{
    vec3 scene = max( texture( scene_tex, v_uv ).rgb, vec3( 0.0 ) );
    vec3 emission = max( texture( emissive_tex, v_uv ).rgb, vec3( 0.0 ) );
    // The scene contributes bright sun/water highlights; a little extra emissive
    // weight keeps small lamps and fire readable without blooming every sprite.
    vec3 source = scene + emission * 0.35;
    float brightness = dot( source, vec3( 0.2126, 0.7152, 0.0722 ) );
    const float threshold = 1.05;
    const float knee = 0.55;
    float soft = clamp( brightness - threshold + knee, 0.0, 2.0 * knee );
    soft = soft * soft / ( 4.0 * knee + 1.0e-5 );
    float contribution = max( brightness - threshold, soft ) / max( brightness, 1.0e-5 );
    vec3 bright = source * contribution;
    // Diffused sun portals and patches get their own path around the ordinary
    // bright-pass threshold. The existing mip chain supplies both a tight edge
    // glow and a broad halo without raising Bloom for unrelated scene lights.
    if( sun_spill_params.x > 0.5 ) {
        bright += max( texture( sun_spill_tex, v_uv ).rgb, vec3( 0.0 ) ) *
                  sun_spill_params.y;
    }
    out_color = vec4( bright, 1.0 );
}
