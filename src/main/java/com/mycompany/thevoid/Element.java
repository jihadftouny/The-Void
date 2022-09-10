/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

/**
 *
 * @author jihad
 */
public class Element {

    public String name;
    
    // ELEMENT OBJECTS
    public static Element physical = new Element("Physical");
    
    public static Element ice = new Element("Cryo");
    public static Element fire = new Element("Pyro");
    public static Element electro = new Element("Electro");
    public static Element poison = new Element("Poison");
    
    public static Element psychic = new Element("Psychic");
    public static Element force = new Element("Force");
    

    public Element(String name) {
        this.name = name;
    }

    
    
}
